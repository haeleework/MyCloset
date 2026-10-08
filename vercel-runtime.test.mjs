import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAppServer} from './app-server.mjs';
import {VercelForecastStore,createCachedHolidays} from './vercel-cache.mjs';
import {collectionBase,places} from './weather.mjs';
const now=new Date('2026-10-08T09:00:00+09:00');
const cache=()=>{const data=new Map();return {get:async k=>structuredClone(data.get(k)),set:async(k,v)=>data.set(k,structuredClone(v))};};
test('production requires an exact HTTPS origin, not forwarded or suffix-matching hosts',async t=>{
 const server=createAppServer({root:'.',store:{subscribe:async()=>{}},readConfig:async()=>{},settings:()=>({features:{cutout:false}}),kick:()=>{},productionOrigins:['https://mycloset.example']});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const request=(host,origin)=>new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/weather-regions',method:'POST',headers:{host,origin,'content-type':'application/json','x-forwarded-host':'mycloset.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end(JSON.stringify({places:['seoul']}));});
 assert.equal(await request('mycloset.example','https://mycloset.example'),202);
 for(const [host,origin] of [['mycloset.example','http://mycloset.example'],['mycloset.example','https://attacker.example'],['mycloset.example.attacker.example','https://mycloset.example.attacker.example'],['localhost','https://mycloset.example']])assert.equal(await request(host,origin),403);
});
test('forecast survives new instances, excludes key material and saved recommendation reads never collect',async()=>{
 const shared=cache();let calls=0;
 const collect=async()=>{calls++;return {base:collectionBase(now),fetchedAt:now.toISOString(),secret:'NEVER_PERSIST',items:['TMP','POP','PTY'].map(category=>({fcstDate:'20261008',fcstTime:'0900',category,fcstValue:category==='TMP'?'21':'0'}))};};
 const first=new VercelForecastStore(shared,collect);await first.refresh(places[0],'data',{now});
 const second=new VercelForecastStore(shared,collect);assert.equal((await second.saved(places[0],'data',{now})).max,21);await second.refresh(places[0],'data',{now});assert.equal(calls,1);
 assert.equal(JSON.stringify(await shared.get('forecast:data:'+places[0].id)).includes('NEVER_PERSIST'),false);
 await assert.rejects(second.saved(places[1],'data',{now}),/NO_SAVED_FORECAST/);assert.equal(calls,1);
});
test('holiday cache is shared and provider failure keeps an explicitly marked seed fallback',async()=>{
 const shared=cache();let calls=0;
 const collect=async year=>{calls++;return {year,complete:true,fetchedAt:now.toISOString(),holidays:[{date:year+'-01-01',name:'신정'}]};};
 const options={cache:shared,seed:{years:{}},getKey:()=>'test-only',collect,now:()=>now};
 await createCachedHolidays(options).snapshot();await createCachedHolidays(options).snapshot();assert.equal(calls,2);
 const fallback=await createCachedHolidays({...options,cache:cache(),getKey:()=>'',seed:{years:{2026:{complete:false,holidays:[]}}}}).snapshot();
 assert.equal(fallback.years[2026].complete,false);assert.equal(fallback.failures[2026],'HOLIDAY_UNAVAILABLE');
});
