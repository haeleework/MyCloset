import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ForecastStore,compareForecasts} from './forecast-store.mjs';
import {baseTime,collectionBase,nextCollectionTime,places} from './weather.mjs';
const place=places[0],morning=new Date('2026-10-06T09:00:00+09:00');
function forecast(now,{temperature=18,dates=['20261006','20261007']}={}){
 return {provider:'data',placeId:place.id,base:baseTime(now),fetchedAt:now.toISOString(),items:dates.flatMap(fcstDate=>[8,18,23].flatMap(hour=>['TMP','POP','PTY'].map(category=>({fcstDate,fcstTime:String(hour).padStart(2,'0')+'00',category,fcstValue:String(category==='TMP'?temperature:0)}))))};
}
async function temporary(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'closet-weather-test-'));
 t.after(async()=>{const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('closet-weather-test-'));await rm(resolved,{recursive:true,force:true});});return directory;
}
test('cold saved read never calls the collector',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async()=>{calls++;});
 await assert.rejects(store.saved(place,'data',{now:morning}),{message:'NO_SAVED_FORECAST'});assert.equal(calls,0);
});
test('background collection is reused after restarting and repeated reads do not collect',async t=>{
 const directory=await temporary(t);let calls=0;
 const collect=async(_,options)=>{calls++;return forecast(options.now);};
 const store=new ForecastStore(directory,collect);assert.equal((await store.refresh(place,'data',{now:morning})).status,'updated');
 await store.saved(place,'data',{now:morning});await store.saved(place,'data',{now:morning});
 const restarted=new ForecastStore(directory,collect);assert.equal((await restarted.saved(place,'data',{now:morning})).cacheSource,'saved');
 assert.equal((await restarted.refresh(place,'data',{now:morning})).status,'saved');assert.equal(calls,1);
});
test('concurrent background requests share one collection',async t=>{
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const store=new ForecastStore(await temporary(t),async(_,options)=>{calls++;await gate;return forecast(options.now);});
 const first=store.refresh(place,'data',{now:morning}),second=store.refresh(place,'data',{now:morning});release();await Promise.all([first,second]);assert.equal(calls,1);
});
test('saved reads remain available while the next publication is blocked', {timeout:3000},async t=>{
 let calls=0,release,started;const gate=new Promise(resolve=>{release=resolve;}),begin=new Promise(resolve=>{started=resolve;});t.after(()=>release());
 const store=new ForecastStore(await temporary(t),async(_,options)=>{if(++calls>1){started();await gate;}return forecast(options.now,{temperature:calls===1?18:22});});
 await store.refresh(place,'data',{now:morning});const now=new Date('2026-10-06T11:15:00+09:00');const updating=store.refresh(place,'data',{now});await begin;
 const old=await store.saved(place,'data',{now});assert.equal(old.max,18);assert.equal(old.refreshStatus,'updating');assert.equal(old.stale,true);
 release();await updating;assert.equal((await store.saved(place,'data',{now})).max,22);
});
test('every publication triggers one collection after its availability buffer',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async(_,options)=>{calls++;return forecast(options.now);});
 await store.refresh(place,'data',{now:morning});await store.refresh(place,'data',{now:new Date('2026-10-06T11:14:59+09:00')});assert.equal(calls,1);
 await store.refresh(place,'data',{now:new Date('2026-10-06T11:15:00+09:00')});assert.equal(calls,2);
 await store.refresh(place,'data',{now:new Date('2026-10-06T11:16:00+09:00')});assert.equal(calls,2);
});
test('all eight boundaries and the next collection date use Korea time',()=>{
 const hours=[2,5,8,11,14,17,20,23];
 for(let i=0;i<hours.length;i++){
  const hour=String(hours[i]).padStart(2,'0');const before=collectionBase(new Date('2026-10-06T'+hour+':14:59+09:00'));
  assert.equal(before.base_time,String(i?hours[i-1]:23).padStart(2,'0')+'00');assert.equal(before.base_date,i?'20261006':'20261005');
  assert.deepEqual(collectionBase(new Date('2026-10-06T'+hour+':15:00+09:00')),{base_date:'20261006',base_time:hour+'00'});
 }
 assert.equal(nextCollectionTime(new Date('2026-10-06T23:16:00+09:00')),'2026-10-06T17:15:00.000Z');
});
test('value comparison ignores publication metadata and identifies changed forecast fields',()=>{
 const old=forecast(morning).items;const latest=old.map(i=>({...i,baseTime:'1100'}));latest[0].fcstValue='20';latest.pop();latest.push({fcstDate:'20261008',fcstTime:'0800',category:'TMP',fcstValue:'19'});
 assert.deepEqual(compareForecasts(old,latest),{added:1,updated:1,removed:1});
 assert.deepEqual(compareForecasts(old,old.map(i=>({...i,baseTime:'1100'})).reverse()),{added:0,updated:0,removed:0});
});
test('late-night future collection preserves the preceding evening and crosses midnight without fetching',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async(_,options)=>{calls++;return forecast(options.now,{dates:calls===1?['20261006','20261007']:['20261007']});});
 await store.refresh(place,'data',{now:new Date('2026-10-06T21:00:00+09:00')});await store.refresh(place,'data',{now:new Date('2026-10-06T23:16:00+09:00')});
 assert.equal((await store.saved(place,'data',{now:new Date('2026-10-06T23:20:00+09:00')})).base.base_time,'2000');
 const next=await store.saved(place,'data',{now:new Date('2026-10-07T00:01:00+09:00')});assert.equal(next.date,'2026-10-07');assert.equal(next.base.base_time,'2300');assert.equal(calls,2);
});
test('future data is saved even if no current-day hours remain',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async(_,options)=>{calls++;return forecast(options.now,{dates:['20261007']});});
 assert.equal((await store.refresh(place,'data',{now:new Date('2026-10-06T23:16:00+09:00')})).status,'updated');
 await assert.rejects(store.saved(place,'data',{now:new Date('2026-10-06T23:20:00+09:00')}),{message:'NO_FORECAST'});
 assert.equal((await store.saved(place,'data',{now:new Date('2026-10-07T00:01:00+09:00')})).date,'2026-10-07');assert.equal(calls,1);
});
test('failed refresh leaves saved data readable and respects retry cooldown',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async(_,options)=>{if(++calls>1)throw new Error('KMA_CONNECTION');return forecast(options.now);});
 await store.refresh(place,'data',{now:morning});const now=new Date('2026-10-06T11:15:00+09:00');
 await assert.rejects(store.refresh(place,'data',{now}),{message:'KMA_CONNECTION'});
 const old=await store.saved(place,'data',{now});assert.equal(old.stale,true);assert.equal(old.refreshStatus,'failed');
 assert.equal((await store.refresh(place,'data',{now:new Date(now.getTime()+60000)})).status,'retry-wait');assert.equal(calls,2);
});
test('expired saved data is excluded without triggering a download',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async(_,options)=>{calls++;return forecast(options.now);});await store.refresh(place,'data',{now:morning});
 await assert.rejects(store.saved(place,'data',{now:new Date('2026-10-06T15:01:00+09:00')}),{message:'STALE_FORECAST'});assert.equal(calls,1);
});
test('three failed automatic attempts stop until explicit retry or a new publication',async t=>{
 let calls=0;const store=new ForecastStore(await temporary(t),async(_,options)=>{calls++;if(calls>1&&calls<5)throw new Error('KMA_CONNECTION');return forecast(options.now);});await store.refresh(place,'data',{now:morning});
 for(const minute of [15,20,25])await assert.rejects(store.refresh(place,'data',{now:new Date('2026-10-06T11:'+minute+':00+09:00')}));
 assert.equal((await store.refresh(place,'data',{now:new Date('2026-10-06T11:30:00+09:00')})).status,'retry-wait');assert.equal(calls,4);
 assert.equal((await store.refresh(place,'data',{now:new Date('2026-10-06T11:31:00+09:00'),retry:true})).status,'updated');assert.equal(calls,5);
});
test('concurrent region registrations persist their union across restart',async t=>{
 const directory=await temporary(t),store=new ForecastStore(directory,async()=>{});await Promise.all([store.subscribe(['seoul']),store.subscribe(['busan'])]);
 const restarted=new ForecastStore(directory,async()=>{});assert.deepEqual((await restarted.activePlaces('data')).map(p=>p.id),['seoul','busan']);
});
test('neither latest nor preceding saved records contain credentials or request URLs',async t=>{
 const directory=await temporary(t),store=new ForecastStore(directory,async(_,options)=>({...forecast(options.now),serviceKey:'test-secret',url:'https://example.invalid?serviceKey=test-secret'}));
 await store.refresh(place,'data',{now:morning});await store.refresh(place,'data',{now:new Date('2026-10-06T11:15:00+09:00')});
 const contents=await readFile(path.join(directory,'data-seoul.json'),'utf8');assert.ok(!contents.includes('test-secret'));assert.ok(!contents.includes('serviceKey'));assert.equal(JSON.parse(contents).changes.updated,0);
});
