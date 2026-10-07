import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGeminiRecommender} from './recommendation-gemini.mjs';
import {GeminiBudget,attemptReserveMicroWon} from './gemini-budget.mjs';
const input=()=>({userId:'user-a',looks:[{candidateId:'c1',itemIds:['g1'],score:20},{candidateId:'c2',itemIds:['g2'],score:10}],wardrobe:[{id:'g1',category:'top',color:'블랙',photo:'SECRET_PHOTO'},{id:'g2',category:'dress',color:'화이트',cutout:'SECRET_CUTOUT'}],profile:{email:'secret@example.com',fit:'여유'},context:{temperature:20}});
const metadata={promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:3,totalTokenCount:123};
const response=()=>({text:JSON.stringify({recommendations:[{candidateId:'c2',tip:'밝은 색 조합을 활용해 보세요.'}]}),usageMetadata:metadata});
function budgetMock(){const calls=[];return {calls,async reserve(){calls.push(['reserve']);return 'r';},async finish(...args){calls.push(['finish',...args]);}};}
test('default disabled and network flag prohibit every provider and budget call',async()=>{
 let calls=0;const budget=budgetMock();for(const options of [{callProvider:()=>calls++},{enabled:true,fetchImpl:()=>calls++}]){const result=await createGeminiRecommender({...options,budget}).recommend(input());assert.equal(result.source,'rules');assert.equal(result.gemini.called,false);}assert.equal(calls,0);assert.equal(budget.calls.length,0);
});
test('only five candidates and whitelisted text enter request; scores and images stay unchanged',async()=>{
 const data=input();data.looks.push(...Array.from({length:4},(_,n)=>({candidateId:'x'+n,itemIds:['g1'],score:n})));const original=structuredClone(data);let body;
 const service=createGeminiRecommender({enabled:true,budget:budgetMock(),callProvider:async request=>{body=request.body;return response();}});const result=await service.recommend(data);
 assert.equal(result.source,'gemini');assert.equal(result.looks[0].candidateId,'c2');assert.equal(result.looks[0].score,10);assert.equal(result.looks[0].stylingTip,'밝은 색 조합을 활용해 보세요.');assert.equal(result.looks.length,5);
 const serialized=JSON.stringify(body);assert.doesNotMatch(serialized,/SECRET_|secret@|inlineData|cutout|photo/);assert.doesNotMatch(body.contents[0].parts[0].text,/score/);assert.equal(JSON.parse(body.contents[0].parts[0].text).candidates.length,5);assert.deepEqual(data,original);assert.deepEqual(result.gemini.usage,{inputTokens:100,outputTokens:20,thoughtTokens:3,totalTokens:123});
});
for(const [label,text] of [['invalid JSON','nope'],['foreign ID',JSON.stringify({recommendations:[{candidateId:'foreign',tip:'팁'}]})],['duplicate ID',JSON.stringify({recommendations:[{candidateId:'c1',tip:'팁'},{candidateId:'c1',tip:'팁'}]})],['extra authority',JSON.stringify({recommendations:[{candidateId:'c1',tip:'팁',score:900}]})],['unsafe HTML',JSON.stringify({recommendations:[{candidateId:'c1',tip:'<script>'}]})]])test(label+' preserves rule order and records billed usage',async()=>{
 const budget=budgetMock();const result=await createGeminiRecommender({enabled:true,budget,callProvider:async()=>({...response(),text})}).recommend(input());assert.equal(result.source,'rules');assert.equal(result.looks[0].candidateId,'c1');assert.equal(budget.calls[1][2],metadata);assert.equal(result.gemini.usage.inputTokens,100);
});
test('cache and simultaneous same request spend only once; user and context isolate caches',async()=>{
 let calls=0,release;const pending=new Promise(resolve=>release=resolve);const service=createGeminiRecommender({enabled:true,budget:budgetMock(),callProvider:async()=>{calls++;await pending;return response();}});
 const a=service.recommend(input()),b=service.recommend(input());release();const results=await Promise.all([a,b]);assert.equal(calls,1);assert.equal(results[1].gemini.cached,true);assert.equal(results[1].gemini.usage.inputTokens,null);
 const cached=await service.recommend(input());assert.equal(cached.gemini.cached,true);assert.equal(calls,1);
 await service.recommend({...input(),userId:'user-b'});await service.recommend({...input(),context:{temperature:8}});assert.equal(calls,3);
});
test('expired/evicted cache permits fresh requests',async()=>{
 let now=0,calls=0;const service=createGeminiRecommender({enabled:true,budget:budgetMock(),now:()=>now,cacheTtlMs:10,maxCacheEntries:1,callProvider:async()=>{calls++;return response();}});await service.recommend(input());now=11;await service.recommend(input());await service.recommend({...input(),userId:'b'});await service.recommend(input());assert.equal(calls,4);
});
test('missing usage stays null, never estimated token counts',async()=>{
 const result=await createGeminiRecommender({enabled:true,budget:budgetMock(),callProvider:async()=>({text:response().text})}).recommend(input());assert.deepEqual(result.gemini.usage,{inputTokens:null,outputTokens:null,thoughtTokens:null,totalTokens:null});
});
test('budget rejection and missing production key prevent provider attempts',async()=>{
 let calls=0;let result=await createGeminiRecommender({enabled:true,budget:{reserve:async()=>{const error=new Error();error.code='TEST_BUDGET_LIMIT';throw error;},finish:async()=>{}},callProvider:async()=>calls++}).recommend(input());assert.equal(result.gemini.reason,'TEST_BUDGET_LIMIT');assert.equal(result.gemini.called,false);
 const budget=budgetMock();result=await createGeminiRecommender({enabled:true,allowNetwork:true,budget,fetchImpl:async()=>calls++}).recommend(input());assert.equal(result.gemini.reason,'KEY_REQUIRED');assert.equal(budget.calls.length,0);assert.equal(calls,0);
});
test('timeout uses separate real test ledger, charges ceiling, and late response cannot release it',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'closet-text-budget-'));const budget=new GeminiBudget(dir,{now:()=>new Date('2026-10-08')});let release;
 try{const service=createGeminiRecommender({enabled:true,budget,timeoutMs:15,callProvider:()=>new Promise(resolve=>release=resolve)});const result=await service.recommend(input());assert.equal(result.source,'rules');assert.equal(result.gemini.reason,'TIMEOUT');let state=await budget.snapshot();assert.equal(state.generationAttempts,1);assert.equal(state.reservedWon,0);assert.equal(state.estimatedUsedWon,attemptReserveMicroWon/1e6);assert.equal(state.uncertainAttempts,1);release(response());await new Promise(resolve=>setTimeout(resolve,5));state=await budget.snapshot();assert.equal(state.estimatedUsedWon,attemptReserveMicroWon/1e6);}finally{await budget.close();await rm(dir,{recursive:true,force:true});}
});
test('shared ledger charges photo and recommendation together and blocks next ceiling reservation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'closet-shared-budget-'));const budget=new GeminiBudget(dir,{now:()=>new Date('2026-10-08')});let calls=0;
 try{const photo=await budget.reserve();await budget.finish(photo,null);const service=createGeminiRecommender({enabled:true,budget,callProvider:async()=>{calls++;return {text:response().text};}});await service.recommend(input());const blocked=await service.recommend({...input(),context:{temperature:10}});assert.equal(blocked.gemini.reason,'TEST_BUDGET_LIMIT');assert.equal(calls,1);assert.equal((await budget.snapshot()).generationAttempts,2);}finally{await budget.close();await rm(dir,{recursive:true,force:true});}
});
