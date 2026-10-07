import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOperationLog,safeError} from './operation-log.mjs';
import {createTraceStore} from './analysis-trace.mjs';
import {createAppServer} from './app-server.mjs';
import {createVisionService} from './wardrobe-vision.mjs';
import {createCutoutService} from './photo-cutout.mjs';
import {sanitizeClientEvent,newClientId} from './client-log.js';
import {ForecastWorker} from './forecast-worker.mjs';
const fixture={mimeType:'image/jpeg',data:Buffer.from([255,216,255,0,0,0]).toString('base64')};
const root=path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/,'$1');
async function temp(t){const dir=await mkdtemp(path.join(tmpdir(),'closet-operation-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function records(dir){return (await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.jsonl')).map(f=>readFile(path.join(dir,f),'utf8')))).join('').trim().split('\n').map(l=>JSON.parse(l));}
test('request stages persist through a new store, with keys/photo/provider message excluded',async t=>{
 const dir=await temp(t),journal=createOperationLog(dir),store=createTraceStore(1,journal),id=randomUUID();
 const trace=store.start(id);trace.mark('image_validation_finished',{bytes:6,imageSha256:'a'.repeat(64),data:fixture.data,key:'secret',message:'personal'});trace.mark('gemini_headers_received',{attempt:1,httpStatus:503});trace.finish('UPSTREAM');await journal.flush();
 const saved=await createTraceStore(1,createOperationLog(dir)).saved(id);assert.equal(saved.status,'UPSTREAM');assert.equal(saved.timeline.find(e=>e.stage==='gemini_headers_received').httpStatus,503);
 const text=JSON.stringify(await records(dir));for(const secret of ['secret','personal',fixture.data])assert.ok(!text.includes(secret));assert.equal(await journal.trace('../../.env'),null);
});
test('rotation and backlog limits are observable; source error locations exclude raw paths/messages',async t=>{
 const dir=await temp(t),journal=createOperationLog(dir,{maxFileBytes:600,maxPending:2});
 for(let i=0;i<20;i++)journal.event('test_event',{count:i});await journal.flush();assert.equal(journal.health().dropped,18);assert.ok((await readdir(dir)).length>=1);
 const e=Object.assign(new Error('SECRET-api-key'),{stack:'Error SECRET\n at C:\\private\\server.mjs:42:3',code:'SECRET'});const safe=safeError(e);assert.equal(safe.file,'server.mjs');assert.equal(safe.line,42);assert.equal(safe.errorCode,'UNKNOWN');assert.ok(!JSON.stringify(safe).includes('SECRET'));
});
test('write failures do not crash app and health does not claim saved',async t=>{
 const dir=await temp(t),file=path.join(dir,'file');await writeFile(file,'x');const journal=createOperationLog(file);journal.event('server_ready');await journal.flush();assert.equal(journal.health().saved,false);assert.equal(journal.health().failed,1);
});
test('client ingestion only accepts fixed event names and primitive operational fields',()=>{
 assert.equal(sanitizeClientEvent({event:'secret-api-key'}),null);
 const event=sanitizeClientEvent({event:'storage_failed',sessionId:randomUUID(),details:{errorName:'QuotaExceededError',message:'secret',photo:fixture.data,source:'personal-note',count:5}});assert.deepEqual(event.details,{errorName:'QuotaExceededError',count:5});
});
test('HTTP -> 503 -> retry -> 503 -> response, disconnect-free logs and client storage error persist',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'closet-operation-')),journal=createOperationLog(dir),key='do-not-log-this-key';let calls=0;
 const vision=createVisionService({getKey:()=>key,wait:async()=>{},fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{status:'UNAVAILABLE',message:'High demand '+key}}),{status:503});}});
 const server=createAppServer({root,store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{},vision,journal});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await journal.flush();await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,id=randomUUID(),headers={'Content-Type':'application/json',Origin:base,'X-Analysis-Id':id};
 const response=await fetch(base+'/api/garment-analysis',{method:'POST',headers,body:JSON.stringify(fixture)});const data=await response.json();assert.equal(response.status,502);assert.equal(data.diagnostics.status,'UPSTREAM');assert.equal(calls,2);
 const client=await fetch(base+'/api/client-events',{method:'POST',headers,body:JSON.stringify({events:[{event:'storage_failed',requestId:id,details:{errorName:'QuotaExceededError',message:key}}]})});assert.equal(client.status,202);
 const health=await (await fetch(base+'/api/log-health')).json();assert.equal(health.saved,true);
 const rows=await records(dir);assert.equal(rows.filter(r=>r.event==='gemini_headers_received').length,2);assert.equal(rows.find(r=>r.event==='gemini_error_received').details.reason,'provider_capacity');assert.ok(rows.some(r=>r.event==='client_storage_failed'));assert.ok(rows.some(r=>r.event==='http_response_finished'));
 const saved=await (await fetch(base+'/api/analysis-trace?request='+id)).json();assert.equal(saved.requestId,id);assert.ok(!JSON.stringify(rows).includes(key));assert.ok(!JSON.stringify(rows).includes(fixture.data));assert.equal((await fetch(base+'/.operation-logs/')).status,404);
 const blocked=await fetch(base+'/api/client-events',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'});assert.equal(blocked.status,403);
});
test('cutout records cache/model/save stages without PNG or source data',async t=>{
 const dir=await temp(t),journal=createOperationLog(dir),service=createCutoutService({cacheDir:path.join(dir,'cutout'),processor:{process:async()=>({png:Buffer.from('private-png'),width:10,height:20})}});
 const mark=(e,d)=>journal.event(e,d);await service.remove(fixture,{mark});await service.remove(fixture,{mark});await journal.flush();const rows=await records(dir);assert.ok(rows.some(r=>r.event==='cutout_model_finished'));assert.ok(rows.some(r=>r.event==='cutout_save_finished'));assert.ok(rows.some(r=>r.event==='cutout_cache_hit'));assert.ok(!JSON.stringify(rows).includes('private-png'));
});
test('ordinary HTTP mobile context without randomUUID still gets a valid correlation ID',()=>{
 assert.match(newClientId({getRandomValues:bytes=>{bytes.fill(1);return bytes;}}),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('weather refresh errors swallowed by background worker still leave safe diagnostic records',async t=>{
 const dir=await temp(t),journal=createOperationLog(dir);
 const worker=new ForecastWorker({activePlaces:async()=>[{id:'private-location'}],refresh:async(_place,{},{mark})=>{mark('weather_provider_started');throw Object.assign(new Error('KMA_CONNECTION'),{privateUrl:'key=secret'});}},async()=>({keyPresent:true,provider:'data'}),{journal});
 await worker.request();await journal.flush();const rows=await records(dir);assert.ok(rows.some(r=>r.event==='weather_provider_started'));const error=rows.find(r=>r.event==='weather_refresh_failed');assert.equal(error.details.errorCode,'KMA_CONNECTION');assert.ok(!JSON.stringify(rows).includes('private-location'));assert.ok(!JSON.stringify(rows).includes('secret'));
});
test('partial and rotated analysis survive restart and are distinguished from successful completion',async t=>{
 const dir=await temp(t),journal=createOperationLog(dir,{maxFileBytes:450}),id=randomUUID(),trace=createTraceStore(1,journal).start(id);
 for(let attempt=1;attempt<=8;attempt++)trace.mark('checkpoint',{attempt});await journal.flush();assert.ok((await readdir(dir)).length>1);
 const partial=await createOperationLog(dir).trace(id);assert.equal(partial.status,'incomplete');assert.equal(partial.timeline.filter(e=>e.stage==='checkpoint').length,8);
 trace.finish('success');await journal.flush();const complete=await createOperationLog(dir).trace(id);assert.equal(complete.status,'success');
});
