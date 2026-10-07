import './backend-network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {networkGuard} from './backend-network-guard.mjs';
import {createGeminiRecommender} from './recommendation-gemini.mjs';
import {createRecommendationService} from './recommendation-service.mjs';
import {createAppServer} from './app-server.mjs';
import {createRuleRecommendations} from './recommendation-rules.js';
import {fileURLToPath} from 'node:url';
import {createSupabaseWardrobeRepository} from './wardrobe-repository.mjs';
import {createSavedWeatherProvider} from './recommendation-weather.mjs';
import {createRecommendationController} from './frontend-recommendations.js';

const wardrobe=[{id:'t1',category:'top',name:'가상 상의',formal:1,warmth:1,color:'흰색'},{id:'b1',category:'bottom',name:'가상 하의',formal:1,warmth:1,color:'검정'},{id:'s1',category:'shoe',name:'가상 신발',formal:1,comfort:true,color:'흰색'}];
const look={candidateId:'look-1',itemIds:['t1','b1','s1'],stylingTip:'규칙 안내',scores:{color:20,total:20},scoreReasons:[]};
const request=()=>({requestId:'independent-22',wardrobeRevision:1,wardrobe:structuredClone(wardrobe),profile:{},context:{formal:0},options:{topK:5}});
const usage={promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:3,totalTokenCount:123};
const fakeBudget=()=>{const records=[];return {records,reserve:async()=>{records.push({type:'reserve'});return 'fake-reservation';},finish:async(id,usage,options)=>records.push({type:'finish',id,usage,options})};};
const modelInput=()=>({looks:[structuredClone(look)],wardrobe:structuredClone(wardrobe),profile:{},context:{},userId:'fictional-owner'});
const mockRules=()=>({looks:[structuredClone(look)],selectedLookId:look.candidateId,diagnostics:{candidatesGenerated:1,candidatesAfterFilter:1,topKCount:1,excludedCounts:{}},warnings:[]});

test('independent guard blocks real Gemini fetch, HTTP(S), TLS and raw sockets before transmission',async()=>{
 const start=networkGuard.blocked.length;
 await assert.rejects(fetch('https://generativelanguage.googleapis.com/v1beta/models/fake:generateContent'),{code:'TEST_NETWORK_BLOCKED'});
 await assert.rejects(fetch(new Request('https://generativelanguage.googleapis.com/')),{code:'TEST_NETWORK_BLOCKED'});
 for(const run of [
  ()=>http.get('http://generativelanguage.googleapis.com/'),
  ()=>https.request({hostname:'generativelanguage.googleapis.com',method:'POST'}),
  ()=>http.request('http://127.0.0.1/',{hostname:'generativelanguage.googleapis.com'}),
  ()=>net.connect(443,'8.8.8.8'),
  ()=>new net.Socket().connect({host:'generativelanguage.googleapis.com',port:443}),
  ()=>tls.connect({host:'generativelanguage.googleapis.com',port:443}),
 ])assert.throws(run,{code:'TEST_NETWORK_BLOCKED'});
 assert.equal(networkGuard.blocked.length-start,8);
});

test('independent guard permits local mock HTTP services',async t=>{
 const server=http.createServer((req,res)=>res.end('{"mock":true}'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 assert.deepEqual(await fetch('http://127.0.0.1:'+server.address().port).then(r=>r.json()),{mock:true});
});

test('independent guard blocks redirects from local mock servers to real Gemini',async t=>{
 const server=http.createServer((req,res)=>{res.writeHead(302,{Location:'https://generativelanguage.googleapis.com/'});res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));const start=networkGuard.blocked.length;
 await assert.rejects(fetch('http://127.0.0.1:'+server.address().port));assert.ok(networkGuard.blocked.length>start);assert.ok(networkGuard.blocked.slice(start).some(b=>b.host==='generativelanguage.googleapis.com'));
});

test('independent Gemini invalid JSON, invented/duplicate IDs, HTML and extra fields all preserve rules',async()=>{
 const invalid=['{',JSON.stringify({recommendations:[{candidateId:'invented',tip:'안내'}]}),JSON.stringify({recommendations:[{candidateId:look.candidateId,tip:'<script>'}]}),JSON.stringify({recommendations:[{candidateId:look.candidateId,tip:'안내',itemIds:['invented']}]}),JSON.stringify({recommendations:[{candidateId:look.candidateId,tip:'안내'},{candidateId:look.candidateId,tip:'중복'}]})];
 for(const text of invalid){const budget=fakeBudget();const service=createGeminiRecommender({enabled:true,budget,callProvider:async()=>({text,usageMetadata:usage})});const result=await service.recommend(modelInput());assert.equal(result.source,'rules');assert.deepEqual(result.looks,[look]);assert.equal(budget.records.filter(r=>r.type==='finish').length,1);}
});

test('independent Gemini timeout bounds even an uncooperative mock provider and settles one reservation',async()=>{
 const budget=fakeBudget();const start=performance.now();let signal;
 const service=createGeminiRecommender({enabled:true,budget,timeoutMs:20,callProvider:input=>{signal=input.signal;return new Promise(()=>{});}});
 const result=await service.recommend(modelInput());assert.equal(result.source,'rules');assert.equal(result.gemini.reason,'TIMEOUT');assert.equal(signal.aborted,true);assert.ok(performance.now()-start<1000);assert.equal(budget.records.filter(r=>r.type==='finish').length,1);
});

test('independent text-only Gemini removes images/private fields and coalesces concurrent identical calls',async()=>{
 let calls=0,body;const budget=fakeBudget();const input=modelInput();input.wardrobe[0].photo='PRIVATE_PHOTO';input.wardrobe[0].name='PRIVATE_NAME';input.profile.email='PRIVATE_EMAIL';input.context.text='PRIVATE_CALENDAR';
 const service=createGeminiRecommender({enabled:true,budget,callProvider:async value=>{calls++;body=value.body;return {text:JSON.stringify({recommendations:[{candidateId:look.candidateId,tip:'실제로 받은 새 안내'}]}),usageMetadata:usage};}});
 const results=await Promise.all([service.recommend(input),service.recommend(input)]);assert.equal(calls,1);assert.equal(results[0].source,'gemini');assert.equal(results[0].looks[0].stylingTip,'실제로 받은 새 안내');assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|inlineData|fileData|image_url/);assert.equal(body.contents[0].parts.length,1);assert.equal(results[0].gemini.usage.totalTokens,123);assert.equal(results[1].gemini.cached,true);
});

test('independent Gemini defaults and absent budget prevent even mock paid-provider attempts',async()=>{
 let calls=0;const provider=async()=>{calls++;throw new Error('unexpected');};
 assert.equal((await createGeminiRecommender({callProvider:provider}).recommend(modelInput())).source,'rules');
 assert.equal((await createGeminiRecommender({enabled:true,callProvider:provider}).recommend(modelInput())).gemini.reason,'BUDGET_UNAVAILABLE');
 assert.equal(calls,0);
});

test('independent recommendation contract echoes revision and never trusts client weather or AI item IDs',async()=>{
 let ruleWeather,aiContext;const raw=request();raw.context.temperatureMin=-999;raw.context.temperatureMax=999;raw.context.temperature=999;raw.context.humidity=999;raw.context.rain=999;raw.weather={min:-999,max:999};raw.scores={total:999};raw.role='admin';
 const weather={min:18,max:22,humidity:60,rain:10};
 const service=createRecommendationService({weatherProvider:async()=>({weather,summary:{temperatureMin:18,temperatureMax:22,humidity:60}}),rules:(w,p,c,forecast)=>{ruleWeather=forecast;return mockRules();},gemini:{recommend:async input=>{aiContext=input.context;return {source:'gemini',looks:[{candidateId:look.candidateId,itemIds:['invented'],stylingTip:'검증된 후보의 새 안내'}],gemini:{attempted:true}};}}});
 const result=await service.recommend(raw);assert.deepEqual(ruleWeather,weather);assert.notEqual(aiContext.temperatureMin,-999);assert.notEqual(aiContext.temperatureMax,999);assert.notEqual(aiContext.temperature,999);assert.notEqual(aiContext.humidity,999);assert.notEqual(aiContext.rain,999);assert.equal(result.requestId,raw.requestId);assert.equal(result.wardrobeRevision,1);assert.deepEqual(result.looks[0].itemIds,look.itemIds);assert.equal(result.weather.temperatureMin,18);assert.equal(result.looks[0].stylingTip,'검증된 후보의 새 안내');
});

test('independent ownership gate requires token and rejects missing or duplicate returned garments',async()=>{
 const raw=request();let called=0;const repository={resolveGarments:async()=>{called++;return {user:{id:'fictional-owner'},wardrobe:[wardrobe[0],wardrobe[0],wardrobe[2]]};}};
 const service=createRecommendationService({mode:'supabase',repository,rules:mockRules});
 await assert.rejects(service.recommend(raw),{code:'AUTH_REQUIRED'});assert.equal(called,0);
 await assert.rejects(service.recommend(raw,{accessToken:'fake-token'}),{code:'WARDROBE_OWNERSHIP_MISMATCH'});
});

test('independent service rejects duplicate wardrobe IDs and invalid option references before providers',async()=>{
 let called=0;const service=createRecommendationService({weatherProvider:async()=>{called++;},rules:mockRules});
 for(const mutate of [raw=>raw.wardrobe.push(raw.wardrobe[0]),raw=>raw.options.requiredId='foreign',raw=>raw.options.topK=6,raw=>raw.options.referenceIds=['foreign']]){const raw=request();mutate(raw);await assert.rejects(service.recommend(raw));}
 assert.equal(called,0);
});

test('independent HTTP origin/content type/access token and private module boundaries',async t=>{
 const seen=[];const recommendations={recommend:async(raw,auth)=>{seen.push(auth);return {...mockRules(),requestId:raw.requestId,wardrobeRevision:raw.wardrobeRevision};}};
 const server=createAppServer({root:fileURLToPath(new URL('.',import.meta.url)),readConfig:async()=>{},settings:()=>({}),recommendations});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;const send=headers=>fetch(origin+'/api/recommendations',{method:'POST',headers,body:JSON.stringify(request())});
 assert.equal((await send({'Content-Type':'application/json'})).status,403);assert.equal((await send({Origin:'https://foreign.invalid','Content-Type':'application/json'})).status,403);assert.equal((await send({Origin:origin,'Content-Type':'text/plain'})).status,403);assert.equal(seen.length,0);
 const good=await send({Origin:origin,'Content-Type':'application/json',Authorization:'Bearer fake-token'});assert.equal(good.status,200);assert.equal((await good.json()).wardrobeRevision,1);assert.deepEqual(seen,[{accessToken:'fake-token'}]);
 for(const file of ['recommendation-gemini.mjs','recommendation-service.mjs','wardrobe-repository.mjs','backend-network-guard.mjs','.env'])assert.equal((await fetch(origin+'/'+file)).status,404);
});

test('independent bounded large wardrobe search returns unique known IDs and preserves input',()=>{
 const large=['top','bottom','shoe','outer'].flatMap(category=>Array.from({length:55},(_,i)=>({id:category+'-'+i,category,name:'가상 '+category+' '+i,color:i%2?'남색':'베이지',warmth:1,formal:1,comfort:true})));
 const before=JSON.stringify(large),started=performance.now();const result=createRuleRecommendations(large,{}, {formal:0,walking:0,cooling:true},{min:18,max:24},{topK:5,maxCandidates:10000,poolLimit:200});
 assert.ok(performance.now()-started<5000);assert.equal(JSON.stringify(large),before);assert.ok(result.looks.length>0&&result.looks.length<=5);assert.equal(new Set(result.looks.map(l=>l.candidateId)).size,result.looks.length);const ids=new Set(large.map(i=>i.id));for(const candidate of result.looks){assert.ok(candidate.itemIds.every(id=>ids.has(id)));assert.equal(candidate.itemIds.length,new Set(candidate.itemIds).size);}
 assert.ok(result.diagnostics.candidatesGenerated<=10000);assert.equal(result.diagnostics.search.limitReached,true);
});

test('independent candidate identities remain distinct when garment IDs contain delimiters',()=>{
 const items=[{id:'a',category:'top'},{id:'a~b',category:'top'},{id:'b~c',category:'bottom'},{id:'c',category:'bottom'},{id:'z',category:'shoe'}].map(i=>({...i,name:'가상 옷',color:'검정',formal:1,warmth:1}));
 const result=createRuleRecommendations(items,{}, {},null,{topK:5});assert.equal(result.looks.length,4);assert.equal(new Set(result.looks.map(l=>l.candidateId)).size,4);
});

test('independent bounded search visits a specifically required garment before unrelated combinations exhaust cap',()=>{
 const items=[{id:'a-top',category:'top'},{id:'z-required-top',category:'top'},{id:'b',category:'bottom'},...Array.from({length:25},(_,n)=>({id:'shoe-'+n,category:'shoe'}))].map(i=>({...i,name:'가상 옷',color:'검정',formal:1,warmth:1}));
 const result=createRuleRecommendations(items,{}, {},null,{requiredId:'z-required-top',maxCandidates:20});assert.ok(result.looks.length>0);assert.ok(result.looks.every(l=>l.itemIds.includes('z-required-top')));
});

const owner='11111111-1111-4111-8111-111111111111';
const otherOwner='22222222-2222-4222-8222-222222222222';
const repoOptions={enabled:true,url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fake'};
test('independent repository rejects foreign rows and missing ownership instead of trusting client user ID',async()=>{
 for(const rows of [[{id:'t1',user_id:otherOwner,attributes:{category:'top'}}],[]]){
  const repo=createSupabaseWardrobeRepository({...repoOptions,fetchImpl:async url=>new Response(JSON.stringify(url.includes('/auth/')?{id:owner}:rows))});
  await assert.rejects(repo.resolveGarments({accessToken:'fake-token',garmentIds:['t1']}),error=>error.status===403);
 }
 let calls=0;const repo=createSupabaseWardrobeRepository({...repoOptions,fetchImpl:async()=>{calls++;}});await assert.rejects(repo.resolveGarments({garmentIds:['t1']}),{code:'AUTH_REQUIRED'});assert.equal(calls,0);
});

test('independent repository upload preserves authenticated ownership and strips image/token values',async()=>{
 let upload;const input={...wardrobe[0],user_id:otherOwner,photo:'PRIVATE_PHOTO',image:'PRIVATE_IMAGE',accessToken:'PRIVATE_TOKEN'};
 const repo=createSupabaseWardrobeRepository({...repoOptions,fetchImpl:async(url,options)=>{if(url.includes('/auth/'))return new Response(JSON.stringify({id:owner}));upload=JSON.parse(options.body);return new Response(JSON.stringify(upload));}});
 const result=await repo.upsertGarments({accessToken:'fake-token',wardrobe:[input]});assert.equal(upload[0].user_id,owner);assert.doesNotMatch(JSON.stringify(upload),/PRIVATE_|accessToken|photo|image/);assert.equal(result.wardrobe[0].id,'t1');assert.equal(input.user_id,otherOwner);
});

test('independent repository times out even if mock fetch ignores abort',async()=>{
 const repo=createSupabaseWardrobeRepository({...repoOptions,timeoutMs:20,fetchImpl:()=>new Promise(()=>{})});const start=performance.now();await assert.rejects(repo.authenticate('fake-token'),{code:'SUPABASE_TIMEOUT'});assert.ok(performance.now()-start<1000);
});

test('independent weather provider only reads saved forecasts, retains forecast label and reports cache timing',async()=>{
 const reads=[];const provider=createSavedWeatherProvider({store:{saved:async place=>{reads.push(place.id);return {placeId:place.id,place:place.name,min:18,max:22,humidity:60,hourly:[],fetchedAt:'2026-10-08T00:00:00Z',source:'기상청 단기예보'};},subscribe:()=>assert.fail('must not subscribe'),collect:()=>assert.fail('must not call provider')},settings:()=>({provider:'data'}),now:()=>new Date('2026-10-08T01:00:00Z')});
 const result=await provider({profile:{locationIds:['seoul']},context:{temperatureMin:-999,humidity:999}});assert.deepEqual(reads,['seoul']);assert.equal(result.summary.kind,'forecast');assert.equal(result.summary.temperatureMin,18);assert.equal(result.summary.humidity,60);assert.equal(result.summary.cached,true);assert.equal(result.timingsMs.weatherProvider,null);assert.equal(typeof result.timingsMs.weatherCacheRead,'number');
});

test('independent real backend HTTP response is accepted by frontend controller',async t=>{
 const recommendations=createRecommendationService({weatherProvider:async()=>({weather:{min:18,max:22},summary:{kind:'forecast',temperatureMin:18,temperatureMax:22}})});
 const server=createAppServer({root:fileURLToPath(new URL('.',import.meta.url)),readConfig:async()=>{},settings:()=>({}),recommendations});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;const controller=createRecommendationController({fetchImpl:(url,options)=>fetch(origin+url,{...options,headers:{...options.headers,Origin:origin}})});
 const input=request();const result=await controller.request(input);assert.equal(result.status,'ready');assert.equal(result.data.source,'rules');assert.ok(result.data.looks.length);assert.deepEqual(new Set(result.data.looks[0].itemIds),new Set(wardrobe.map(i=>i.id)));assert.equal(result.data.diagnostics.gemini.called,false);
});

test('independent unexpected Gemini module failure still returns usable rules',async()=>{
 const service=createRecommendationService({rules:mockRules,gemini:{recommend:async()=>{throw new Error('PRIVATE_PROVIDER_DETAILS');}}});const result=await service.recommend(request());assert.equal(result.source,'rules');assert.deepEqual(result.looks,[look]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER_DETAILS/);
});
