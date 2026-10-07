import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuleRecommendations as rules} from './recommendation-rules.js';
import {createRecommendationService} from './recommendation-service.mjs';
import {recommend,contexts} from './engine.js';
import {assessDressItem,dressPolicy} from './dress-policy.js';
import {outfitComfort} from './outfit-comfort.js';

const item=(id,category,extra={})=>({id,name:id,category,formal:1,warmth:1,color:'검정',available:true,...extra});
const base=()=>[item('t','top',{itemType:'셔츠',color:'남색'}),item('b','bottom',{itemType:'슬랙스',color:'베이지'}),item('s','shoe',{itemType:'단화',comfort:true})];
const office={routine:'출근',text:'출근',formal:2,walking:0,sensitivities:[]};
const profile={routine:'출근',days:[1,2,3,4,5],dressCode:2};
const weather={min:20,max:22,humidity:40};
const options={modifier:'comfort',referenceIds:['t','b','s']};
const jeans=()=>item('jeans','bottom',{name:'블랙 팬츠',itemType:'청바지',formal:0,fit:'여유 있는 핏'});

test('ordinary office accepts black jeans despite legacy formal score zero, even profile dressCode 2',()=>{
 const result=rules([...base(),jeans()],profile,office,weather,options);
 assert.ok(result.looks[0].itemIds.includes('jeans'));
 assert.equal(result.comfortAdjustment.changedCategories.length,1);
 assert.equal(result.diagnostics.preferencePolicy.dress,'neat-casual-office');
});
test('comfort beats a higher harmony score and all top-k choices remain comfort ordered',()=>{
 const closet=[...base(),jeans(),item('chino','bottom',{itemType:'치노',color:'베이지'})];
 const result=rules(closet,profile,office,weather,options);
 assert.ok(result.looks[0].itemIds.includes('jeans'));
 const second=result.looks.find(l=>l.itemIds.includes('chino'));
 assert.ok(second);assert.ok(result.looks[0].scores.color<second.scores.color);
 const values=result.looks.map(l=>outfitComfort(l.itemIds.map(id=>closet.find(i=>i.id===id))).score);
 assert.deepEqual(values,[...values].sort((a,b)=>b-a));
});
test('office excludes slippers and training clothes even with high formality and comfort numbers',()=>{
 const closet=[...base(),jeans(),item('sports','bottom',{itemType:'트레이닝 팬츠',formal:2,comfort:true,fit:'와이드'}),item('slippers','shoe',{itemType:'슬리퍼',formal:2,comfort:true})];
 const result=rules(closet,profile,office,weather);
 assert.ok(result.looks.length);assert.ok(result.looks.every(l=>!l.itemIds.includes('sports')&&!l.itemIds.includes('slippers')));
 assert.ok(result.diagnostics.excludedCounts.office_slippers>0);assert.ok(result.diagnostics.excludedCounts.office_sportswear>0);
});
test('neat casual is not a blanket ban on sneakers, hoodies or tailored joggers',()=>{
 for(const [category,itemType] of [['shoe','운동화'],['top','무지 후드 티셔츠'],['bottom','테일러드 조거 팬츠']])assert.equal(assessDressItem(item('x',category,{itemType,formal:0}),office).excluded,null);
 assert.equal(assessDressItem(item('x','bottom',{name:'트레이닝 팬츠',itemType:'슬랙스',formal:0}),office).excluded,null);
});
test('explicit interview or suit requirement keeps strict formality despite office routine',()=>{
 for(const text of ['출근 후 면접','출근, 정장 필수','회사 중요한 미팅']){
  const result=rules([...base().map(i=>({...i,formal:2})),jeans()],profile,{...office,text},weather,options);
  assert.ok(result.looks.length);assert.ok(result.looks.every(l=>!l.itemIds.includes('jeans')));
 }
});
test('holiday, remote and non-office context do not acquire an office restriction',()=>{
 for(const text of ['휴가','출근 안 함','재택'])assert.notEqual(dressPolicy(contexts(profile,text,'2026-10-08')).mode,'neat-casual-office');
 assert.equal(assessDressItem(item('s','shoe',{itemType:'슬리퍼',formal:0}),{formal:0}).excluded,null);
});
test('weather required exclusions cannot be offset by comfort or office permission',()=>{
 const closet=[...base(),item('shorts','bottom',{itemType:'숏팬츠',length:'short',warmth:0,comfort:true,fit:'와이드'})];
 const result=rules(closet,profile,office,{min:5,max:8},options);
 assert.ok(result.looks.every(l=>!l.itemIds.includes('shorts')));
 assert.ok(result.diagnostics.excludedCounts.cold_light>0);
});
test('extreme registered color clash is blocked, ordinary unknown color is allowed',()=>{
 const colored=base().map(i=>({...i,colorHue:0,colorChroma:90,colorLightness:50}));
 colored.push(item('o','outer',{itemType:'재킷',color:'빨강',colorHue:0,colorChroma:90,colorLightness:50}));
 const clash=item('clash','bottom',{itemType:'청바지',formal:0,fit:'여유',color:'초록',colorHue:180,colorChroma:90,colorLightness:50});
 const uncertain=jeans();const result=rules([...colored,clash,uncertain],profile,office,weather,{modifier:'comfort',referenceIds:['t','b','s','o']});
 assert.ok(result.looks[0].itemIds.includes('jeans'));assert.ok(!result.looks.some(l=>l.itemIds.includes('clash')));
 assert.ok(result.comfortAdjustment.blockedReasons.includes('color'));
});
test('one-step changes repeat until no better eligible garment, never forced sportswear',()=>{
 const closet=[...base(),jeans(),item('sports','bottom',{itemType:'트레이닝 바지',formal:0,comfort:true,fit:'와이드'})];
 const first=rules(closet,profile,office,weather,options);
 const next=rules(closet,profile,office,weather,{...options,referenceIds:first.looks[0].itemIds});
 assert.equal(next.comfortAdjustment.status,'unchanged');assert.ok(next.looks[0].itemIds.includes('jeans'));
});
test('offline fallback uses the same office and comfort policy',()=>{
 const closet=[...base(),jeans(),item('sports','bottom',{itemType:'트레이닝 바지',formal:0,comfort:true})];
 const result=recommend(closet,profile,office,weather,options);
 assert.ok(result.outfit.some(i=>i.id==='jeans'));assert.ok(result.outfit.every(i=>i.id!=='sports'));
});
test('all office-inappropriate alternatives return no acceptable look rather than fabricate one',()=>{
 const closet=[base()[0],item('b','bottom',{itemType:'트레이닝 팬츠',formal:2}),base()[2]];
 assert.equal(rules(closet,profile,office,weather).looks.length,0);
 assert.equal(recommend(closet,profile,office,weather).outfit,null);
});
test('service keeps comfort order and never asks Gemini to override it',async()=>{
 let calls=0;
 const service=createRecommendationService({weatherProvider:async()=>({weather}),gemini:{recommend:async()=>{calls++;throw Error('must not call');}}});
 const response=await service.recommend({requestId:'office-test',wardrobeRevision:1,wardrobe:[...base(),jeans()],profile,context:office,options});
 assert.equal(calls,0);assert.ok(response.looks[0].itemIds.includes('jeans'));
 assert.equal(response.diagnostics.gemini.called,false);
});
test('rules do not rewrite clothing formality, provenance or input order',()=>{
 const closet=[...base(),jeans()];const original=structuredClone(closet);
 rules(closet,profile,office,weather,options);assert.deepEqual(closet,original);
});
