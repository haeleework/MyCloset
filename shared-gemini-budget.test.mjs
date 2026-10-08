import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SharedGeminiBudget} from './shared-gemini-budget.mjs';
import {createBudgetBridge} from './database/budget-bridge.mjs';
import {attemptReserveMicroWon} from './budget-cost.mjs';
const token='a'.repeat(64),url='https://example.supabase.co/functions/v1/budget';
const id='00000000-0000-4000-8000-000000000001';
const req=(input,key=token)=>new Request(url,{method:'POST',headers:{'X-Closet-Budget-Key':key},body:JSON.stringify(input)});
const setup=()=>{const calls=[];const bridge=createBudgetBridge({secretHash:createHash('sha256').update(token).digest('hex'),endpoint:'https://example.supabase.co',serviceKey:'sb_secret_fixture',now:()=>new Date('2026-10-08'),fetchImpl:async(url,opts)=>{calls.push({url,...JSON.parse(opts.body),headers:opts.headers});return Response.json({ok:true});}});return {calls,bridge};};
test('bridge rejects unauthenticated and arbitrary operations before DB access',async()=>{
 const {calls,bridge}=setup();assert.equal((await bridge(req({op:'snapshot'},'bad'))).status,401);
 assert.equal((await bridge(req({op:'sql',query:'anything'}))).status,400);assert.equal(calls.length,0);
});
test('bridge reservation fixes account and upper limit; secret key is apikey only',async()=>{
 const {calls,bridge}=setup();assert.equal((await bridge(req({op:'reserve',id,purpose:'photo-analysis',cap:999999}))).status,200);
 assert.equal(calls[0].p_reserved_won,attemptReserveMicroWon/1e6);assert.equal(calls[0].p_budget_key,'mycloset-shared-2026-10-07');assert.equal(calls[0].headers.Authorization,undefined);
});
test('missing usage stays fully charged and supplied charge is ignored',async()=>{
 const {calls,bridge}=setup();await bridge(req({op:'finish',id,usage:null,chargedWon:0}));assert.equal(calls[0].p_uncertain,true);assert.equal(calls[0].p_charged_won,attemptReserveMicroWon/1e6);
});
test('known usage settles including thinking tokens; unbilled error releases reservation',async()=>{
 const {calls,bridge}=setup();await bridge(req({op:'finish',id,usage:{promptTokenCount:100,candidatesTokenCount:10,thoughtsTokenCount:10,totalTokenCount:120}}));assert.equal(calls[0].p_uncertain,false);assert.equal(calls[0].p_charged_won,.36);
 await bridge(req({op:'finish',id,httpStatus:400}));assert.equal(calls[1].p_charged_won,0);
});
test('remote failure never falls back to a fresh local allowance',async()=>{
 const b=new SharedGeminiBudget({url,token,fetchImpl:async()=>{throw Error('network');}});await assert.rejects(b.reserve(),{code:'BUDGET_UNAVAILABLE'});
});
test('shared snapshot accounts for existing spend and pending reservations',async()=>{
 const b=new SharedGeminiBudget({url,token,now:()=>new Date('2026-10-08'),fetchImpl:async()=>Response.json({capWon:5000,estimatedUsedWon:402,reservedWon:2478,generationAttempts:51,knownUsageUsd:.16,uncertainAttempts:1})});const s=await b.snapshot();assert.equal(s.availableWon,2120);assert.equal(s.canRequest,false);
});
test('price expiry blocks new generation without calling bridge',async()=>{
 const b=new SharedGeminiBudget({url,token,now:()=>new Date('2027-01-01'),fetchImpl:()=>assert.fail('must not call')});await assert.rejects(b.reserve(),{code:'BUDGET_PRICE_EXPIRED'});
});
