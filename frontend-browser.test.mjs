// Browser transport boundary tests in Node. Actual visual/UI checks use CUA only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrontendFixture} from './frontend-fixture-server.mjs';
import {createRecommendationController} from './frontend-recommendations.js';
import {demoState} from './persona.js';

async function fixture(t){
  const f=createFrontendFixture();await new Promise(resolve=>f.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{f.server.closeAllConnections();f.server.close(resolve);}));
  const base=`http://127.0.0.1:${f.server.address().port}`;
  const call=(url,options)=>fetch(base+url,options);
  const control=(scenario,delayMs=0)=>call('/__fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario,delayMs})});
  const input={wardrobeRevision:'fixture-1',wardrobe:demoState().closet,profile:{},context:{},options:{topK:5}};
  return {...f,call,control,input};
}
test('fixture has two distinct looks and strips private media from transport',async t=>{
  const f=await fixture(t),controller=createRecommendationController({fetchImpl:f.call});
  const r=await controller.request(f.input);assert.equal(r.status,'ready');assert.equal(r.data.looks.length,2);assert.notDeepEqual(r.data.looks[0].itemIds,r.data.looks[1].itemIds);
  assert.deepEqual(f.requests.find(x=>x.path==='/api/recommendations').mediaKeys,[]);assert.equal(r.data.diagnostics.gemini.called,false);
});
test('zero candidates is valid; unknown item ID is refused',async t=>{
  const f=await fixture(t),controller=createRecommendationController({fetchImpl:f.call});
  await f.control('zero');let r=await controller.request(f.input);assert.equal(r.status,'ready');assert.equal(r.data.looks.length,0);
  await f.control('bad-id');r=await controller.request(f.input);assert.equal(r.status,'error');assert.equal(r.error.code,'invalid_items');
});
test('duplicate pending submissions make one HTTP recommendation request',async t=>{
  const f=await fixture(t);await f.control('two',40);const controller=createRecommendationController({fetchImpl:f.call});
  const a=controller.request(f.input),b=controller.request(f.input);assert.equal(a,b);await a;
  assert.equal(f.requests.filter(x=>x.path==='/api/recommendations').length,1);
});
test('wardrobe revision changes prevent delayed response application',async t=>{
  const f=await fixture(t);await f.control('two',60);let current=f.input;
  const controller=createRecommendationController({fetchImpl:f.call,getCurrentSnapshot:()=>current});const pending=controller.request(f.input);
  current={...f.input,wardrobeRevision:'fixture-2',wardrobe:f.input.wardrobe.slice(1)};
  assert.equal((await pending).status,'ignored');assert.equal(controller.state.data,null);
});
test('server error and timeout surface explicit errors without a result',async t=>{
  const f=await fixture(t),controller=createRecommendationController({fetchImpl:f.call,timeoutMs:30});
  await f.control('error');assert.equal((await controller.request(f.input)).error.code,'fixture_error');
  await f.control('two',100);assert.equal((await controller.request(f.input)).error.code,'timeout');assert.equal(controller.state.data,null);
});
test('fixture explicitly blocks photo APIs and non-public files',async t=>{
  const f=await fixture(t);for(const url of ['/api/garment-analysis','/api/photo-analysis','/api/photo-cutout'])assert.equal((await f.call(url,{method:'POST',body:'{}'})).status,403);
  for(const url of ['/.env','/server.mjs','/node_modules/anything.js'])assert.equal((await f.call(url)).status,404);
  const r=await f.call('/');assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);
});
test('reordered fixture repeats selected candidate despite skip for UI regression',async t=>{
  const f=await fixture(t);await f.control('reordered');const controller=createRecommendationController({fetchImpl:f.call});
  const first=await controller.request(f.input),next=await controller.request({...f.input,options:{skip:1}});
  assert.equal(first.data.selectedLookId,'fixture-2');assert.equal(next.data.selectedLookId,'fixture-2');assert.equal(next.data.looks.length,2);
});
test('comfort-one fixture returns one adjustment but preserves two normal alternatives',async t=>{
  const f=await fixture(t);await f.control('comfort-one');const controller=createRecommendationController({fetchImpl:f.call});
  const comfort=await controller.request({...f.input,options:{modifier:'comfort'}}),other=await controller.request({...f.input,options:{modifier:'',skip:1}});
  assert.equal(comfort.data.validCandidateCount,1);assert.equal(other.data.validCandidateCount,2);
});
