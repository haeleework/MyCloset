import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ForecastStore} from './forecast-store.mjs';
import {ForecastWorker} from './forecast-worker.mjs';
import {createAppServer} from './app-server.mjs';
import {baseTime,places} from './weather.mjs';
const now=new Date('2026-10-06T09:00:00+09:00');
async function setup(t,collector){
 const directory=await mkdtemp(path.join(os.tmpdir(),'closet-weather-http-'));
 const store=new ForecastStore(directory,collector),settings=()=>({keyPresent:true,provider:'data'});
 const worker=new ForecastWorker(store,async()=>settings(),{now:()=>now});
 const server=createAppServer({root:path.dirname(fileURLToPath(import.meta.url)),store,readConfig:async()=>{},settings,kick:options=>worker.request(options).catch(()=>{}),now:()=>now});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{worker.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('closet-weather-http-'));await rm(directory,{recursive:true,force:true});});
 return {store,worker,origin};
}
function record(place){return {provider:'data',placeId:place.id,base:baseTime(now),fetchedAt:now.toISOString(),items:['TMP','POP','PTY'].map(category=>({fcstDate:'20261006',fcstTime:'0900',category,fcstValue:category==='TMP'?'19':'0'}))};}
test('HTTP saved reads never start a collection; registration returns while collection is blocked',{timeout:4000},async t=>{
 let calls=0,release,started;const gate=new Promise(resolve=>{release=resolve;}),begin=new Promise(resolve=>{started=resolve;});t.after(()=>release());
 const {worker,origin}=await setup(t,async place=>{calls++;started();await gate;return record(place);});
 assert.equal((await fetch(origin+'/api/weather?places=seoul')).status,202);assert.equal(calls,0);
 const registration=await fetch(origin+'/api/weather-regions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({places:['seoul']})});
 assert.equal(registration.status,202);assert.equal((await registration.json()).registered,true);await begin;
 assert.equal((await fetch(origin+'/api/weather?places=seoul')).status,202);assert.equal(calls,1);
 release();await worker.running;
 const result=await (await fetch(origin+'/api/weather?places=seoul')).json();assert.equal(result.cacheSource,'saved');assert.equal(result.max,19);
 await fetch(origin+'/api/weather?places=seoul');assert.equal(calls,1);
});
test('secondary missing regions are disclosed while primary saved data is returned',async t=>{
 const {store,origin}=await setup(t,async place=>record(place));await store.refresh(places[0],'data',{now});
 const response=await fetch(origin+'/api/weather?places=seoul,busan'),result=await response.json();assert.equal(response.status,200);assert.equal(result.forecasts.length,1);assert.deepEqual(result.missingPlaces,['부산 · 연제 대표지점']);
});
test('available second selected city is returned even when the first city is missing',async t=>{
 const {store,origin}=await setup(t,async place=>record(place));await store.refresh(places[1],'data',{now});
 const response=await fetch(origin+'/api/weather?places=seoul,busan'),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.placeId,'busan');assert.deepEqual(result.requestedPlaceIds,['seoul','busan']);assert.deepEqual(result.missingPlaces,['서울 · 종로 대표지점']);
});
test('private files and cross-origin registration remain blocked',async t=>{
 let calls=0;const {origin}=await setup(t,async()=>{calls++;});
 for(const file of ['.env','.weather-cache/data-seoul.json','forecast-store.mjs','app-server.mjs'])assert.equal((await fetch(origin+'/'+file)).status,404);
 assert.equal((await fetch(origin+'/api/weather-regions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({places:['seoul']})})).status,403);
 assert.equal((await fetch(origin+'/api/weather?places=../.env')).status,400);assert.equal(calls,0);
});
