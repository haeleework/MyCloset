import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {holidayOnDate} from './holidays.js';
import {contexts} from './engine.js';
import {parseHolidayResponse,collectHolidayYear,HolidayStore} from './holiday-store.mjs';
import {createAppServer} from './app-server.mjs';
const cleanup=async directory=>{if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('closet-holiday-'))throw new Error('unexpected test cleanup path');await rm(directory,{recursive:true,force:true});};
const now=new Date('2026-10-07T04:00:00Z');
const profile={routine:'출근',days:[1,2,3,4,5],dressCode:1,walking:30,cooling:true,heating:true,exposure:'indoor'};
const item=(date,name,isHoliday='Y')=>({locdate:Number(date.replaceAll('-','')),dateName:name,isHoliday});
const response=items=>({response:{header:{resultCode:'00'},body:{totalCount:items.length,items:{item:items}}}});
const record=(year=2026,holidays=[{date:'2026-10-09',name:'한글날'}])=>({year,complete:true,holidays,fetchedAt:now.toISOString(),source:'한국천문연구원 특일 정보 API'});
const day=(date='2026-10-09')=>holidayOnDate({years:{2026:record()}},date,now.getTime());
test('public holiday suspends weekday routine, formality and its commute/indoor conditions',()=>{
 const c=contexts(profile,'','2026-10-09',[],day());
 assert.equal(c.autoHoliday,true);assert.equal(c.routine,'');assert.equal(c.walking,0);assert.equal(c.cooling,false);assert.equal(c.heating,false);assert.equal(c.formal,0);
});
test('holiday outing keeps only explicit appointment/walking needs',()=>{
 const c=contexts(profile,'저녁 약속 / 도보 이동','2026-10-09',[],day());
 assert.equal(c.autoHoliday,true);assert.equal(c.formal,1);assert.equal(c.walking,30);assert.equal(c.routine,'');assert.equal(c.cooling,false);
});
test('explicit work overrides holiday even outside recurring weekdays; leave overrides work',()=>{
 for(const text of ['공휴일에도 출근','오늘 출근','출근 후 저녁 약속','휴일 근무']){
  const c=contexts({...profile,days:[]},text,'2026-10-09',[],day());
  assert.equal(c.routine,'출근');assert.equal(c.holidayOverride,true);assert.equal(c.autoHoliday,false);assert.equal(c.walking,30);
 }
 const c=contexts(profile,'오늘은 휴가 / 출근 안 함','2026-10-09',[],day());assert.equal(c.routine,'');assert.equal(c.walking,0);
 const school=contexts({...profile,routine:'등교'},'공휴일에도 등교','2026-10-09',[],day());assert.equal(school.routine,'등교');
});
test('nonholiday and unknown holiday data keep existing weekday routine',()=>{
 for(const holiday of [null,{isHoliday:null},day('2026-10-07')])assert.equal(contexts(profile,'','2026-10-07',[],holiday).routine,'출근');
 const c=contexts(profile,'재택','2026-10-09',[],day());assert.equal(c.remote,true);assert.equal(c.routine,'');assert.equal(c.walking,0);
});
test('limited and old snapshots recognize positive dates without certifying other days',()=>{
 const bundle={years:{2026:{...record(),complete:false}}};
 assert.equal(holidayOnDate(bundle,'2026-10-09',now.getTime()).isHoliday,true);
 assert.equal(holidayOnDate(bundle,'2026-10-07',now.getTime()).isHoliday,null);
 assert.equal(holidayOnDate({years:{2026:record()}},'2026-10-07',now.getTime()+2*86400000).isHoliday,null);
 assert.equal(holidayOnDate(bundle,'2027-01-01',now.getTime()).known,false);
 assert.equal(holidayOnDate(bundle,'2026-02-30',now.getTime()).known,false);
});
test('official holidays include substitutes and temporary days but exclude nonholiday commemorations',()=>{
 const r=parseHolidayResponse(response([item('2026-10-05','대체공휴일'),item('2026-10-09','한글날'),item('2026-10-08','검증용 임시공휴일'),item('2026-10-01','국군의 날','N')]),2026,now);
 assert.equal(r.holidays.length,3);assert(!r.holidays.some(h=>h.date==='2026-10-01'));
 assert.equal(parseHolidayResponse({response:{header:{resultCode:'00'},body:{totalCount:1,items:{item:item('2026-10-09','한글날')}}}},2026,now).holidays.length,1);
});
test('empty, partial pages, invalid dates/years and auth failures cannot replace a complete calendar',()=>{
 for(const r of [response([]),response([item('2026-02-30','invalid')]),response([item('2027-01-01','wrong year')]),{response:{header:{resultCode:'00'},body:{totalCount:2,items:{item:[item('2026-10-09','한글날')]}}}}])assert.throws(()=>parseHolidayResponse(r,2026,now));
 assert.throws(()=>parseHolidayResponse({response:{header:{resultCode:'30'}}},2026,now),{code:'HOLIDAY_AUTH'});
});
test('encoded and decoded keys are sent once to the official HTTPS endpoint; errors expose no key',async()=>{
 let calls=0;
 const collect=async url=>{calls++;assert.equal(url.protocol,'https:');assert.equal(url.hostname,'apis.data.go.kr');assert.equal(url.searchParams.get('ServiceKey'),'test/key=');assert.equal(url.searchParams.has('solMonth'),false);return new Response(JSON.stringify(response([item('2026-10-09','한글날')])));};
 await collectHolidayYear(2026,'test%2Fkey%3D',{fetchImpl:collect,now});assert.equal(calls,1);
 await assert.rejects(collectHolidayYear(2026,'test/key=',{fetchImpl:async()=>new Response('SERVICE_KEY_IS_NOT_REGISTERED_ERROR private-key',{status:403})}),{code:'HOLIDAY_AUTH',message:'HOLIDAY_AUTH'});
});
test('cache refresh is daily, combines concurrent calls, survives restart, and retains old data on error',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'closet-holiday-'));let calls=0;let clock=now;
 const collect=async(year)=>{calls++;if(calls>2)throw Object.assign(new Error('connection'),{code:'HOLIDAY_CONNECTION'});return record(year,[{date:year+'-10-09',name:'한글날'}]);};
 try{
  const store=new HolidayStore(directory,{collect,now:()=>clock});await Promise.all([store.refresh(async()=>'fake'),store.refresh(async()=>'fake')]);assert.equal(calls,2);
  await store.refresh(async()=>'fake');assert.equal(calls,2);const old=await store.snapshot();assert.equal(old.years[2026].complete,true);
  const restarted=new HolidayStore(directory,{collect,now:()=>clock});assert.equal((await restarted.snapshot()).years[2026].holidays[0].name,'한글날');
  clock=new Date(now.getTime()+2*86400000);await store.refresh(async()=>'fake');assert.equal((await store.snapshot()).years[2026].holidays[0].name,'한글날');assert.equal((await store.snapshot()).failures[2026],'HOLIDAY_CONNECTION');
  assert(!(await readFile(path.join(directory,'2026.json'),'utf8')).includes('fake'));
 }finally{await cleanup(directory);}
});
test('disk write failure does not replace the last saved holiday calendar',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'closet-holiday-write-')),blocked=path.join(directory,'file');
 try{await writeFile(blocked,'blocked');const store=new HolidayStore(blocked,{collect:async year=>record(year,[{date:year+'-10-09',name:'한글날'}]),now:()=>now});await store.refresh(async()=>'fake');assert.equal((await store.snapshot()).years[2026],undefined);assert.equal((await store.snapshot()).failures[2026],'HOLIDAY_SAVE_FAILED');}
 finally{await cleanup(directory);}
});
test('a later official calendar can add and remove a temporary holiday without merging stale rows',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'closet-holiday-change-'));let clock=now,temporary=false;
 const collect=async year=>({...record(year,[{date:year+'-01-01',name:'1월1일'},...(temporary?[{date:year+'-10-08',name:'검증용 임시공휴일'}]:[])]),fetchedAt:clock.toISOString()});
 try{
  const store=new HolidayStore(directory,{collect,now:()=>clock});await store.refresh(async()=>'fake');
  assert.equal(holidayOnDate(await store.snapshot(),'2026-10-08',clock.getTime()).isHoliday,false);
  temporary=true;clock=new Date(clock.getTime()+2*86400000);await store.refresh(async()=>'fake');
  assert.equal(holidayOnDate(await store.snapshot(),'2026-10-08',clock.getTime()).isHoliday,true);
  temporary=false;clock=new Date(clock.getTime()+2*86400000);await store.refresh(async()=>'fake');
  assert.equal(holidayOnDate(await store.snapshot(),'2026-10-08',clock.getTime()).isHoliday,false);
 }finally{await cleanup(directory);}
});
test('HTTP holiday reads never collect upstream and private caches remain inaccessible',async()=>{
 let kicks=0;const holidays={snapshot:async()=>({version:1,years:{2026:record()}})};
 const server=createAppServer({root:process.cwd(),store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{},holidays,holidayKick:()=>{kicks++;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/api/holidays')).status,200);assert.equal((await fetch(url+'/api/holidays')).status,200);assert.equal(kicks,0);
  assert.equal((await fetch(url+'/.holiday-cache/2026.json')).status,404);assert.equal((await fetch(url+'/holiday-seed.json')).status,404);
  assert.equal((await fetch(url+'/api/holiday-refresh',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:'{}'})).status,202);assert.equal(kicks,1);
  assert.equal((await fetch(url+'/api/holiday-refresh',{method:'POST',headers:{Origin:'http://other-site','Content-Type':'application/json'},body:'{}'})).status,403);assert.equal(kicks,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
