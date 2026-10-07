import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GeminiBudget,usageCost,attemptReserveMicroWon} from './gemini-budget.mjs';
import {createVisionService} from './wardrobe-vision.mjs';
const clock=()=>new Date('2026-10-07T00:00:00Z');
async function setup(t,opts={}){const dir=await mkdtemp(path.join(os.tmpdir(),'closet-budget-'));const b=new GeminiBudget(dir,{now:clock,...opts});t.after(()=>b.close());await b.ready;return b;}
test('thinking is included once and invalid usage is never free',()=>{
 const c=usageCost({promptTokenCount:1424,candidatesTokenCount:600,thoughtsTokenCount:100,totalTokenCount:2124});assert.equal(c.outputTokens,700);assert.ok(c.estimatedMicroWon>0);assert.equal(c.usd,(1424*.75+700*3.75)/1e6);
 for(const u of [null,{}, {promptTokenCount:-1,candidatesTokenCount:0,totalTokenCount:0},{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:0}])assert.equal(usageCost(u),null);
 assert.ok(attemptReserveMicroWon<2500e6);
});
test('concurrent reservations cannot overspend; settlement and restart preserve history',async t=>{
 const b=await setup(t);const reservations=await Promise.allSettled([b.reserve(),b.reserve(),b.reserve()]);assert.equal(reservations.filter(r=>r.status==='fulfilled').length,2);assert.equal(reservations[2].reason.code,'TEST_BUDGET_LIMIT');
 await b.finish(reservations[0].value,{promptTokenCount:100,candidatesTokenCount:100,totalTokenCount:200});const first=await b.snapshot();assert.ok(first.estimatedUsedWon>0);assert.equal(first.uncertainAttempts,1);
 await b.close();const reopened=new GeminiBudget(b.dir,{now:clock});t.after(()=>reopened.close());await reopened.ready;assert.deepEqual(await reopened.snapshot(),first);
 const id=await reopened.reserve();await reopened.finish(id,null);assert.equal((await reopened.snapshot()).canRequest,false);
});
test('unresolved cancellation keeps worst-case cost; explicitly unbilled error frees it',async t=>{
 const b=await setup(t);const id=await b.reserve();await b.finish(id,null);assert.equal((await b.snapshot()).uncertainAttempts,1);assert.equal((await b.snapshot()).estimatedUsedWon,attemptReserveMicroWon/1e6);
 const second=await b.reserve();await b.finish(second,null,{httpStatus:400});assert.equal((await b.snapshot()).generationAttempts,2);assert.equal((await b.snapshot()).estimatedUsedWon,attemptReserveMicroWon/1e6);
});
test('corrupt ledger, competing process and expired prices fail closed',async t=>{
 const b=await setup(t);const competing=new GeminiBudget(b.dir,{now:clock});await assert.rejects(competing.ready,e=>e.code==='BUDGET_UNAVAILABLE');await competing.close();
 const expired=await setup(t,{now:()=>new Date('2027-01-01T00:00:00Z')});await assert.rejects(expired.reserve(),e=>e.code==='BUDGET_PRICE_EXPIRED');
 await b.close();await writeFile(b.file,(await readFile(b.file,'utf8'))+'invalid\n');const corrupted=new GeminiBudget(b.dir,{now:clock});t.after(()=>corrupted.close());await assert.rejects(corrupted.ready,e=>e.code==='BUDGET_UNAVAILABLE');await assert.rejects(corrupted.reserve(),e=>e.code==='BUDGET_UNAVAILABLE');
});
test('budget blocks paid fetch before transmission and missing usage is charged conservatively',async t=>{
 let calls=0;const b=await setup(t,{capWon:2000});const photo={mimeType:'image/jpeg',data:Buffer.from([255,216,255,224]).toString('base64')};
 const blocked=createVisionService({budget:b,getKey:()=> 'fake-test-key',fetchImpl:async()=>{calls++;return new Response('{}');}});await assert.rejects(blocked.analyze(photo),e=>e.code==='TEST_BUDGET_LIMIT');assert.equal(calls,0);
 const allowed=await setup(t);const invalid=createVisionService({budget:allowed,getKey:()=> 'fake-test-key',fetchImpl:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]}))});await assert.rejects(invalid.analyze(photo),e=>e.code==='INVALID_ANALYSIS');assert.equal((await allowed.snapshot()).uncertainAttempts,1);
 const raw=await readFile(allowed.file,'utf8');assert.ok(!raw.includes('fake-test-key'));assert.ok(!raw.includes(photo.data));
});
test('dead server owner can restart without losing unresolved cost reservations',async t=>{
 const b=await setup(t);await b.reserve();const before=await b.snapshot();await b.close();await writeFile(b.lockFile,'2147483647');
 const restarted=new GeminiBudget(b.dir,{now:clock});t.after(()=>restarted.close());await restarted.ready;assert.deepEqual(await restarted.snapshot(),before);
});
