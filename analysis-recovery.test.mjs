import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseAnalysisText,validationMessages} from './vision-format.js';
import {mergeAnalysisDraft} from './garment-fields.js';
import {createVisionService} from './wardrobe-vision.mjs';
import {createAppServer} from './app-server.mjs';
import {contexts,recommend,alternativeRegistration,comfortAdjustmentMessage} from './engine.js';
const field=(value,uncertainty='명확함')=>({value,uncertainty,evidence:'합성 시험 관찰'});
const valid=()=>({attributes:{category:field('상의'),item_type:field('티셔츠'),main_color:field('회색','추정'),pattern:field('무지'),surface_visual:field('골지'),silhouette_visual:field('직선','추정'),length_visual:field(null,'모름')},visible_details:['소매'],uncertain_fields:['main_color','silhouette_visual','length_visual'],photo_quality:{usable_for_registration:'가능',lighting_note:'시험',occlusion_note:'시험'}});
const input={mimeType:'image/jpeg',data:Buffer.from([255,216,255,224,0,1]).toString('base64')};
const response=(text,finishReason='STOP')=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}));
test('JSON, required, enum, unknown-with-value, extra and length failures have safe distinct paths',()=>{
 const cases=[['','EMPTY_OUTPUT','analysis'],['private-photo-content {','INVALID_JSON','analysis']];
 const missing=valid();delete missing.attributes.category;cases.push([JSON.stringify(missing),'MISSING_FIELD','analysis.attributes.category']);
 const bad=valid();bad.attributes.category.value='private-label';cases.push([JSON.stringify(bad),'INVALID_ENUM','analysis.attributes.category.value']);
 const contradiction=valid();contradiction.attributes.length_visual.value='private-length';cases.push([JSON.stringify(contradiction),'UNKNOWN_WITH_VALUE','analysis.attributes.length_visual.value']);
 const extra=valid();extra.attributes['private-key']='private-value';cases.push([JSON.stringify(extra),'UNEXPECTED_FIELD','analysis.attributes']);
 const long=valid();long.attributes.main_color.value='x'.repeat(161);cases.push([JSON.stringify(long),'TEXT_TOO_LONG','analysis.attributes.main_color.value']);
 const wrong=valid();wrong.visible_details={secret:'private-value'};cases.push([JSON.stringify(wrong),'INVALID_TYPE','analysis.visible_details']);
 const many=valid();many.visible_details=Array(16).fill('private-value');cases.push([JSON.stringify(many),'TOO_MANY_ITEMS','analysis.visible_details']);
 for(const [text,issue,path] of cases)assert.throws(()=>parseAnalysisText(text),e=>e.code==='INVALID_ANALYSIS'&&e.validationIssue===issue&&e.validationPath===path&&!JSON.stringify(e).includes('private'));
 assert.deepEqual(parseAnalysisText(JSON.stringify(valid())),valid());
});
test('invalid Gemini output is charged once, has a safe checkpoint, and a later valid analysis recovers',async()=>{
 let calls=0,charged=0;const marks=[];
 const service=createVisionService({getKey:()=> 'test-only-key',budget:{reserve:async()=> 'mock-reservation',finish:async(id,usage)=>{assert.ok(usage);charged++;}},fetchImpl:async()=>response(++calls===1?'private malformed':JSON.stringify(valid()))});
 await assert.rejects(service.analyze(input,{mark:(stage,details)=>marks.push({stage,...details})}),e=>e.validationIssue==='INVALID_JSON');
 assert.equal(charged,1);assert.equal(calls,1);assert.ok(marks.some(m=>m.stage==='output_validation_failed'&&m.validationIssue==='INVALID_JSON'));assert.doesNotMatch(JSON.stringify(marks),/private malformed|test-only-key/);
 assert.equal((await service.analyze(input)).userReview.status,'pending');assert.equal(charged,2);
});
test('incomplete output and empty output are distinguished without a paid auto retry',async()=>{
 for(const [text,finish,issue] of [['','STOP','EMPTY_OUTPUT'],['private truncated','MAX_TOKENS','INCOMPLETE_OUTPUT']]){
  let calls=0;const s=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>{calls++;return response(text,finish);}});
  await assert.rejects(s.analyze(input),e=>e.code==='INVALID_ANALYSIS'&&e.validationIssue===issue);assert.equal(calls,1);
 }
});
test('HTTP failure returns a useful message and safe trace but never model text or keys',async()=>{
 const vision=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>response('private-photo-content {')});
 const server=createAppServer({root:path.dirname(fileURLToPath(import.meta.url)),store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{},vision});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const origin='http://127.0.0.1:'+server.address().port;const r=await fetch(origin+'/api/garment-analysis',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});const b=await r.json();assert.equal(r.status,502);assert.equal(b.code,'INVALID_ANALYSIS');assert.match(b.error,new RegExp(validationMessages.INVALID_JSON));assert.ok(b.diagnostics.timeline.some(m=>m.validationIssue==='INVALID_JSON'));assert.doesNotMatch(JSON.stringify(b),/private-photo-content|test-key/);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('reanalysis preserves corrections and intentional clears while updating untouched AI values',()=>{
 const prior={name:'회색 티셔츠',color:'회색',pattern:'무지',surface:'골지'};
 const current={name:'내 티셔츠',color:'회색',pattern:'',surface:'골지'};
 const next={name:'검정 티셔츠',color:'검정',pattern:'줄무늬',surface:'매끈함'};
 const merged=mergeAnalysisDraft(current,prior,next);assert.deepEqual(merged.values,{name:'내 티셔츠',color:'검정',pattern:'',surface:'매끈함'});assert.deepEqual(merged.preserved,['name','pattern']);
 assert.equal(mergeAnalysisDraft({color:'회색'}, {color:'회색'}, {color:'검정'},{editedFields:['color']}).values.color,'회색');
 assert.equal(mergeAnalysisDraft({name:'직접 입력'},null,{name:'AI 이름'}).values.name,'직접 입력');
 assert.equal(mergeAnalysisDraft({name:''},null,{name:'AI 이름'}).values.name,'AI 이름');
 assert.equal(mergeAnalysisDraft({name:''},null,{name:'AI 이름'},{editedFields:['name']}).values.name,'');
});
const closet=()=>[
 ['top-grey','top','회색',null,null],['top-black','top','검정',null,null],['top-sweat','top','검정',null,null],
 ['bottom-beige','bottom','베이지',1,false],['bottom-black','bottom','검정',0,true],
 ['shoe-grey','shoe','회색',1,true],['shoe-white','shoe','흰색',0,false],
 ['outer-khaki','outer','초록',1,null],['outer-hood','outer','검정',null,null]
].map(([id,category,color,formal,comfort])=>({id,name:id,category,color,formal,comfort,warmth:null,available:true}));
const profile={routine:'출근',days:[1,2,3,4,5],walking:30,dressCode:1,cooling:false,heating:false,exposure:'mixed',fit:'',moodPreferences:[]};
test('nine-item closet has alternatives; a comfortable bottom that fails the event formality is excluded',()=>{
 const clothes=closet(),ctx=contexts(profile,'재택 후 저녁 약속','2026-10-07');assert.equal(alternativeRegistration(clothes).ready,true);assert.equal(ctx.walking,0);
 const weather={min:12,max:18},base=recommend(clothes,profile,ctx,weather),comfortable=recommend(clothes,profile,ctx,weather,{modifier:'comfort'});
 assert.equal(base.total,6);assert.equal(base.outfit.find(i=>i.category==='bottom').id,'bottom-beige');assert.equal(comfortable.signature,base.signature);
 assert.notEqual(recommend(clothes,profile,ctx,weather,{modifier:'comfort',skip:1}).signature,base.signature);
 assert.equal(recommend(clothes,profile,ctx,{min:26,max:29}).total,3);
 assert.match(comfortAdjustmentMessage(clothes,ctx,comfortable),/일정의 격식/);
});
test('unknown shoe comfort gives an honest same-result explanation instead of claiming improvement',()=>{
 const clothes=closet().map(i=>({...i,comfort:null})),ctx=contexts(profile,'재택 후 저녁 약속','2026-10-07');
 const base=recommend(clothes,profile,ctx,null),next=recommend(clothes,profile,ctx,null,{modifier:'comfort'});assert.equal(base.signature,next.signature);assert.match(comfortAdjustmentMessage(clothes,ctx,next),/아직 모름/);assert.ok(!next.reasons.some(r=>r.includes('편하다고 등록한 신발')));
 assert.match(comfortAdjustmentMessage(clothes,ctx,next),/옷의 종류·핏·스타일/);
});
