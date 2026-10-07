import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {provinces,districtPlaces,townPlaces,placeById,regionSource} from './region-data.js';
import {places,baseTime} from './weather.mjs';
import {regionIds,cityName,selectedWeather} from './user-settings.js';
import {setupResult} from './onboarding.js';
import {ForecastStore} from './forecast-store.mjs';
import {ForecastWorker} from './forecast-worker.mjs';
import {createAppServer} from './app-server.mjs';
const gangnam=districtPlaces.find(p=>p.province==='서울특별시'&&p.district==='강남구');
const yeongtong=districtPlaces.find(p=>p.province==='경기도'&&p.district==='수원시영통구');
const sinsa=townPlaces.find(p=>p.districtId===gangnam.id&&p.town==='신사동');
const maetan=townPlaces.find(p=>p.districtId===yeongtong.id&&p.town==='매탄1동');
test('official source extraction preserves all district IDs, parent provinces and grid coordinates',async()=>{
 const data=JSON.parse(await readFile(new URL('./region-data.json',import.meta.url),'utf8'));
 assert.deepEqual(data.provinces,provinces);assert.deepEqual(data.districts,districtPlaces);assert.equal(regionSource.dataDate,'2026-07-01');
 assert.equal(provinces.length,16);assert.equal(districtPlaces.length,256);assert.equal(new Set(places.map(p=>p.id)).size,places.length);
 for(const p of districtPlaces){assert.match(p.id,/^kma-\d{10}$/);assert.ok(provinces.some(s=>s.id===p.provinceId));assert.ok(Number.isInteger(p.nx)&&p.nx>0&&Number.isInteger(p.ny)&&p.ny>0);assert.notEqual(p.province,'이어도');}
 assert.equal(gangnam.id,'kma-1168000000');assert.deepEqual([gangnam.nx,gangnam.ny],[61,126]);assert.equal(yeongtong.districtLabel,'수원시 영통구');
 assert.ok(districtPlaces.some(p=>p.province==='인천광역시'&&p.district==='영종구'));
 assert.deepEqual(data.towns,townPlaces);assert.equal(townPlaces.length,3564);
 for(const p of townPlaces){const parent=placeById.get(p.districtId);assert.equal(parent.provinceId,p.provinceId);assert.equal(parent.district,p.district);assert.match(p.id,/^kma-\d{10}$/);assert.ok(Number.isInteger(p.nx)&&Number.isInteger(p.ny));}
 assert.equal(sinsa.id,'kma-1168051000');assert.deepEqual([sinsa.nx,sinsa.ny],[61,126]);assert.equal(maetan.name,'경기도 수원시 영통구 매탄1동');
});
test('district IDs survive setup, duplicate removal and explicit clearing without guessing an old city district',()=>{
 const result=setupResult({locationIds:[gangnam.id,yeongtong.id,gangnam.id,'made-up']});
 assert.deepEqual(result.locationIds,[gangnam.id,yeongtong.id]);assert.equal(result.locationId,gangnam.id);
 assert.equal(cityName(gangnam.id),'서울특별시 강남구');assert.equal(cityName(yeongtong.id),'경기도 수원시 영통구');
 assert.deepEqual(regionIds({locationId:'seoul'}),['seoul']);assert.deepEqual(regionIds({locationId:gangnam.id,locationIds:[]}),[]);
 assert.deepEqual(setupResult({locationIds:[sinsa.id,maetan.id,sinsa.id]}).locationIds,[sinsa.id,maetan.id]);
 assert.equal(cityName(sinsa.id),'서울특별시 강남구 신사동');
});
test('stored district forecasts affect outfit weather and disclose missing districts',()=>{
 const date='2026-10-07',now=Date.parse(date+'T12:00:00+09:00');
 const weather={date,source:'기상청 단기예보',forecasts:[{date,source:'기상청 단기예보',placeId:gangnam.id,min:17,max:24,rain:50,snow:false,fetchedAt:new Date(now).toISOString()}]};
 const result=selectedWeather({locationIds:[gangnam.id,yeongtong.id],weather},date,now);
 assert.equal(result.placeId,gangnam.id);assert.equal(result.rain,50);assert.equal(result.partial,true);assert.deepEqual(result.missingPlaces,['경기도 수원시 영통구']);
});
test('district registration collects only subscribed regions; repeated weather GETs read cache without collecting',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'closet-district-'));const now=new Date('2026-10-07T12:00:00+09:00');let calls=0;
 const store=new ForecastStore(directory,async place=>{calls++;return {provider:'data',placeId:place.id,base:baseTime(now),fetchedAt:now.toISOString(),items:['TMP','POP','PTY'].map(category=>({fcstDate:'20261007',fcstTime:'1200',category,fcstValue:category==='TMP'?'22':'0'}))};});
 const settings=()=>({keyPresent:true,provider:'data'}),worker=new ForecastWorker(store,async()=>settings(),{now:()=>now});
 const server=createAppServer({root:path.dirname(fileURLToPath(import.meta.url)),store,settings,readConfig:async()=>{},kick:options=>worker.request(options),now:()=>now});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{worker.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('closet-district-'));await rm(directory,{recursive:true,force:true});});
 assert.equal((await fetch(origin+'/api/weather?places='+sinsa.id)).status,202);assert.equal(calls,0);
 const register=async ids=>fetch(origin+'/api/weather-regions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({places:ids})});
 assert.equal((await register(['kma-0000000000'])).status,400);assert.equal((await register(districtPlaces.slice(0,9).map(p=>p.id))).status,400);
 assert.equal((await register([sinsa.id,maetan.id])).status,202);await worker.request();assert.equal(calls,2);
 assert.deepEqual((await store.activePlaces('data')).map(p=>p.id),[sinsa.id,maetan.id]);
 for(let i=0;i<2;i++){const result=await (await fetch(origin+'/api/weather?places='+[sinsa.id,maetan.id].join(','))).json();assert.equal(result.forecasts.length,2);assert.equal(result.forecasts[0].placeId,sinsa.id);assert.equal(result.cacheSource,'saved');}
 assert.equal(calls,2);assert.equal((await fetch(origin+'/region-data.js')).status,200);assert.equal((await fetch(origin+'/.weather-cache/data-'+gangnam.id+'.json')).status,404);
});
