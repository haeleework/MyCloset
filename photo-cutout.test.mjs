import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCutoutService,createWorkerProcessor} from './photo-cutout.mjs';
import {createAppServer} from './app-server.mjs';
const input={mimeType:'image/jpeg',data:Buffer.from([255,216,255,224,0,1]).toString('base64')};
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const fixture=()=>({png,width:1024,height:1024,foregroundRatio:.5});
async function temporaryCache(t){const dir=await mkdtemp(path.join(os.tmpdir(),'closet-cutout-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('same image reuses persisted PNG across service restart without another model call',async t=>{
 const cacheDir=await temporaryCache(t);let calls=0;const original=input.data;
 const processor={process:async()=>{calls++;return fixture();}};
 const service=createCutoutService({cacheDir,processor});const a=await service.remove(input),b=await service.remove(input);
 assert.equal(a.cached,false);assert.equal(b.cached,true);assert.equal(a.data,png.toString('base64'));assert.equal(a.mimeType,'image/png');assert.equal(input.data,original);assert.equal(calls,1);
 const restarted=createCutoutService({cacheDir,processor});assert.equal((await restarted.remove(input)).cached,true);assert.equal(calls,1);
});
test('unsupported photos never reach the model; cancellation does not cache and frees the busy slot',async t=>{
 const cacheDir=await temporaryCache(t);let release,calls=0;const gate=new Promise(resolve=>release=resolve);
 const service=createCutoutService({cacheDir,processor:{process:async()=>{calls++;if(calls===1)await gate;return fixture();}}});
 await assert.rejects(service.remove({...input,mimeType:'image/heic'}),e=>e.code==='INVALID_IMAGE');assert.equal(calls,0);
 const controller=new AbortController();const pending=service.remove(input,{signal:controller.signal});
 while(!calls)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(service.remove(input),e=>e.code==='BUSY');controller.abort();release();await assert.rejects(pending,e=>e.code==='CANCELLED');
 assert.equal((await readdir(cacheDir)).length,0);assert.equal((await service.remove(input)).cached,false);assert.equal(calls,2);
});
test('worker time limit terminates processing and already-cancelled work never starts',async()=>{
 const processor=createWorkerProcessor(1);try{await assert.rejects(processor.process(Buffer.from([255,216,255])),e=>e.code==='TIMEOUT');const controller=new AbortController();controller.abort();await assert.rejects(processor.process(png,{signal:controller.signal}),e=>e.code==='CANCELLED');}finally{await processor.close();}
});
test('photo cutout API uses local processor, preserves origin checks and keeps cache private',async t=>{
 let calls=0;const cacheDir=await temporaryCache(t),cutouts=createCutoutService({cacheDir,processor:{process:async()=>{calls++;return fixture();}}});
 const root=path.dirname(fileURLToPath(import.meta.url));const server=createAppServer({root,store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{},cutouts});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;
 const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)};
 const response=await fetch(origin+'/api/photo-cutout',options);assert.equal(response.status,200);const result=await response.json();assert.equal(result.sourceSha256.length,64);assert.equal(calls,1);
 const repeat=await fetch(origin+'/api/photo-cutout',options).then(r=>r.json());assert.equal(repeat.cached,true);assert.equal(calls,1);
 const forbidden=await fetch(origin+'/api/photo-cutout',{...options,headers:{'Content-Type':'application/json'}});assert.equal(forbidden.status,403);assert.equal(calls,1);
 assert.equal((await fetch(origin+'/.cutout-cache/test.json')).status,404);assert.equal((await fetch(origin+'/cutout-worker.mjs')).status,404);
});
