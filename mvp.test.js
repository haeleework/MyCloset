import test from 'node:test';import {assessDressItem} from './dress-policy.js';
import assert from 'node:assert/strict';
import {demoState,fresh} from './persona.js';
import {contexts,recommend,alternativeRegistration} from './engine.js';
import {weatherPlan} from './conditions.js';
import {warmthBias} from './learning.js';
import {baseTime,normalizeForecast,getForecast,places} from './weather.mjs';
const date='2026-10-06',sample=demoState();
const context=(text='출근 후 저녁 약속')=>contexts(sample.profile,text,date);
test('12개 옷장: 상의5 하의3 신발2 겉옷2로 첫 추천과 다른 조합을 제공한다',()=>{
 assert.deepEqual(alternativeRegistration(sample.closet).counts,{top:5,bottom:3,shoe:2,outer:2,dress:0});
 assert.equal(alternativeRegistration(sample.closet).ready,true);
 const a=recommend(sample.closet,sample.profile,context(),sample.weather),b=recommend(sample.closet,sample.profile,context(),sample.weather,{skip:1});
 assert.equal(a.outfit.length,4);assert.notEqual(a.signature,b.signature);assert.ok(a.outfit.every(i=>sample.closet.some(o=>o.id===i.id)));
 assert.equal(a.outfit.find(i=>i.category==='shoe').comfort,true);assert.ok(a.outfit.every(i=>!assessDressItem(i,context()).excluded));
});
test('출근 후 저녁 약속의 비 예보는 우산과 가벼운 겉옷으로 안내한다',()=>{
 const p=weatherPlan(sample.weather,context());assert.equal(p.umbrella,true);assert.equal(p.outerTarget,1);assert.equal(p.snow,false);
 const outfit=recommend(sample.closet,sample.profile,context(),sample.weather).outfit;assert.equal(outfit.find(i=>i.category==='outer').name,'베이지 가디건');
});
test('새벽 최저기온이 낮아도 활동 시간에 따뜻하면 그 최저기온으로 겉옷을 강제하지 않는다',()=>{
 const c={...context('출근'),cooling:false,sensitive:'보통'};
 const w={min:9,max:27,rain:0,hourly:[{hour:3,temp:9},{hour:8,temp:22,rain:0,pty:0},{hour:18,temp:24,rain:0,pty:0}]};
 const p=weatherPlan(w,c);assert.equal(p.outerNeeded,false);assert.equal(p.low,22);
});
test('더운 날 강한 냉방은 두꺼운 니트 대신 얇은 상의와 가벼운 겉옷으로 대비한다',()=>{
 const w={min:26,max:33,rain:0,hourly:[8,9,18,19].map(hour=>({hour,temp:30,rain:0,pty:0}))};
 const r=recommend(sample.closet,sample.profile,context(),w);assert.equal(r.outfit.find(i=>i.category==='top').warmth,0);assert.equal(r.outfit.find(i=>i.category==='outer').warmth,1);
});
test('겨울의 강한 실내 난방은 벗을 겉옷과 실내 상의를 구분하고 보온 한계를 안내한다',()=>{
 const c={...context('출근'),heating:true,cooling:false},w={min:-3,max:6,rain:0,snow:true};
 const r=recommend(sample.closet,sample.profile,c,w);assert.equal(r.outfit.find(i=>i.category==='outer').warmth,2);assert.equal(r.outfit.find(i=>i.category==='top').warmth,1);assert.ok(r.notices.some(t=>t.includes('겨울용')));
});
test('오늘 휴가나 재택을 누르면 출근에 붙은 이동·냉방·난방 조건을 제거한다',()=>{
 for(const text of ['오늘은 휴가','재택']){const c=contexts({...sample.profile,heating:true},text,date);assert.equal(c.routine,'');assert.equal(c.walking,0);assert.equal(c.cooling,false);assert.equal(c.heating,false);}
});
test('일정에 다른 지원 도시가 있으면 그 시간의 예보도 준비사항에 반영한다',()=>{
 const w={...sample.weather,rain:0,hourly:[{hour:8,temp:24,rain:0,pty:0},{hour:19,temp:24,rain:0,pty:0}],forecasts:[{place:'부산 · 연제 대표지점',hourly:[{hour:19,temp:10,rain:80,pty:1}]}]};
 const p=weatherPlan(w,{...context(),events:[{location:'부산 해운대',title:'저녁 약속',hour:19,endHour:21}]});assert.equal(p.low,10);assert.equal(p.umbrella,true);
});
test('날씨 정보가 없으면 우산이 필요없다고 단정하지 않는다',()=>{const p=weatherPlan(null,context());assert.equal(p.known,false);assert.equal(p.umbrella,null);assert.ok(p.actions[0].includes('확인'));});
test('실제로 입은 피드백이 비슷한 기온에서 반복되어야 보온 선호를 조정한다',()=>{
 const a={date:'2026-10-04',wore:true,feeling:'cold',season:'mild'},w={max:20};
 assert.equal(warmthBias([a],w,date),0);assert.equal(warmthBias([a,{...a,date:'2026-10-05'}],w,date),1);
 assert.equal(warmthBias([a,{...a,wore:false,date:'2026-10-05'}],w,date),0);
 assert.equal(warmthBias([a,{...a,date:'2026-10-05'}],{max:30},date),0);
 assert.equal(warmthBias([{...a,date:'2026-08-01'},{...a,date:'2026-08-02'}],w,date),0);
});
test('기상청 발표 시각은 한국 날짜 경계를 포함해 이미 발표한 자료를 선택한다',()=>{
 assert.deepEqual(baseTime(new Date('2026-10-05T15:10:00Z')),{base_date:'20261005',base_time:'2300'});
 assert.deepEqual(baseTime(new Date('2026-10-05T23:50:00Z')),{base_date:'20261006',base_time:'0800'});
});
const forecastItems=[['TMP','18'],['POP','70'],['PTY','2'],['WSD','3']].map(([category,fcstValue])=>({fcstDate:'20261006',fcstTime:'1900',category,fcstValue}));
test('기상청 코드에서 기온·비확률·진눈깨비를 읽고 다른 날짜는 제외한다',()=>{
 const w=normalizeForecast([...forecastItems,{fcstDate:'20261007',fcstTime:'1900',category:'TMP',fcstValue:'99'}],date);assert.equal(w.min,18);assert.equal(w.max,18);assert.equal(w.snow,true);assert.equal(w.rain,70);assert.equal(w.hourly[0].wind,3);
 assert.throws(()=>normalizeForecast([],date));
});
test('일부 시간만 받은 기온을 하루 최저·최고로 표시하지 않는다',()=>{
 const w=normalizeForecast(forecastItems,date);assert.equal(w.rangeKind,'forecast-hours');assert.equal(w.fromHour,19);assert.equal(w.throughHour,19);
 const daily=normalizeForecast([...forecastItems,{fcstDate:'20261006',fcstTime:'0600',category:'TMN',fcstValue:'12'},{fcstDate:'20261006',fcstTime:'1500',category:'TMX',fcstValue:'23'}],date);assert.equal(daily.rangeKind,'daily');assert.equal(daily.min,12);assert.equal(daily.max,23);
});
test('기상청 연결은 키를 한 번 인코딩하고 인증 실패를 일반 메시지로 분류한다',async()=>{
 let requested;
 const result=await getForecast(places[0],'abc%2B123%3D',{now:new Date('2026-10-06T00:00:00Z'),fetcher:async url=>{requested=new URL(url);return {ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{totalCount:4,items:{item:forecastItems}}}})};}});
 assert.equal(requested.searchParams.get('serviceKey'),'abc+123=');assert.equal(result.source,'기상청 단기예보');assert.ok(!JSON.stringify(result).includes('abc'));
 await assert.rejects(getForecast(places[0],'bad-key',{fetcher:async()=>({ok:true,json:async()=>({response:{header:{resultCode:'30'}}})})}),/KMA_KEY/);
 await assert.rejects(getForecast(places[0],''),/KEY_REQUIRED/);
});
