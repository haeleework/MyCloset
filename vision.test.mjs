import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisionService,decodeImage,maxImageBytes,providerFailureInfo} from './wardrobe-vision.mjs';
import {colorFamily,analysisDraft,validateAnalysis,visionProgressText,visionTimeoutMs,visionClientTimeoutMs} from './vision-format.js';
import {createAppServer} from './app-server.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const input={mimeType:'image/jpeg',data:Buffer.from([255,216,255,224,0,1]).toString('base64')};
const field=(value,uncertainty='명확함')=>({value,uncertainty,evidence:'시험용 관찰 근거'});
const analysis={attributes:{category:field('상의'),item_type:field('긴소매 라운드넥 티셔츠'),main_color:field('블랙/차콜 계열','추정'),pattern:field('무지'),surface_visual:field('광택이 적음'),silhouette_visual:field('직선적인 형태','추정'),length_visual:field(null,'모름')},visible_details:['긴 소매'],uncertain_fields:['main_color','silhouette_visual','length_visual'],photo_quality:{usable_for_registration:'가능',lighting_note:'어두운 조명',occlusion_note:'가림 없음'}};
const success=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(analysis)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{'Content-Type':'application/json'}});
test('slow but historically successful responses are allowed; the delay notice is not a failure',()=>{
 assert.ok(visionTimeoutMs>40208,'the previously successful 40.2-second response must not be cut off');
 assert.ok(visionClientTimeoutMs>visionTimeoutMs,'the server must have time to return its timeout reason');
 assert.match(visionProgressText(30001),/기다리는/);assert.doesNotMatch(visionProgressText(30001),/중단|실패/);
});
test('approximate color families preserve the original free description; physical fit is not inferred',()=>{
 assert.equal(colorFamily('블랙/차콜 계열'),'회색');assert.equal(colorFamily('진청'),'남색');assert.equal(colorFamily('연노랑'),'노랑');assert.equal(colorFamily('판별 불가'),'');
 const draft=analysisDraft(analysis);assert.equal(draft.colorDescription,'블랙/차콜 계열');assert.equal(draft.category,'top');assert.equal(draft.fit,undefined);assert.equal(draft.warmth,undefined);
});
test('invalid types, forged headers, malformed and oversized images never call Gemini',async()=>{
 let calls=0;const service=createVisionService({getKey:()=> 'test-key',fetchImpl:()=>{calls++;}});
 for(const value of [{mimeType:'image/heic',data:input.data},{mimeType:'image/png',data:input.data},{mimeType:'image/jpeg',data:'%%%%'},{...input,data:'A'.repeat(Math.ceil(maxImageBytes/3)*4+4)}])await assert.rejects(service.analyze(value));
 assert.equal(calls,0);assert.equal(decodeImage(input).bytes.length,6);
});
test('successful response retains raw inference and leaves physical attributes unknown',async()=>{
 const service=createVisionService({getKey:()=> 'test-key',fetchImpl:async(url,options)=>{assert.ok(url.endsWith(':generateContent'));assert.equal(options.headers['x-goog-api-key'],'test-key');const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.data,input.data);return success();}});
 const result=await service.analyze(input);assert.deepEqual(result.analysis,analysis);assert.equal(result.userReview.status,'pending');assert.equal(result.physicalAttributes.warmth,null);assert.equal(JSON.stringify(result).includes('test-key'),false);
});
test('one bounded retry for 503, no retries for auth errors and no provider body leakage',async()=>{
 let calls=0,delays=0;const service=createVisionService({getKey:()=> 'test-key',wait:async()=>{delays++;},fetchImpl:async()=>++calls===1?new Response('provider-secret-body',{status:503}):success()});
 assert.equal((await service.analyze(input)).attempts,2);assert.equal(calls,2);assert.equal(delays,1);
 calls=0;const denied=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>{calls++;return new Response('provider-secret-body',{status:403});}});await assert.rejects(denied.analyze(input),e=>e.code==='AUTH'&&!e.message.includes('provider-secret-body'));assert.equal(calls,1);
});
test('concurrent analyses are blocked even while loading the key; service recovers afterward',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const service=createVisionService({getKey:async()=>{await gate;return 'test-key';},fetchImpl:async()=>success()});const pending=service.analyze(input);await assert.rejects(service.analyze(input),e=>e.code==='BUSY');release();await pending;assert.equal((await service.analyze(input)).userReview.status,'pending');
});
test('quota errors do not trigger immediate retries or leak provider messages; cooldown blocks another call',async()=>{
 const payload={error:{status:'RESOURCE_EXHAUSTED',message:'secret-provider-message',details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'42s'},{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',subject:'private-project-id'}]}]}};
 const info=providerFailureInfo(payload,new Headers());assert.equal(info.retryAfterMs,42000);assert.equal(info.providerStatus,'RESOURCE_EXHAUSTED');assert.ok(!JSON.stringify(info).includes('secret'));assert.ok(!JSON.stringify(info).includes('private-project'));
 let calls=0;const service=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>{calls++;return new Response(JSON.stringify(payload),{status:429});}});
 await assert.rejects(service.analyze(input),e=>e.code==='QUOTA');await assert.rejects(service.analyze(input),e=>e.code==='QUOTA');assert.equal(calls,1);
 const dailyPayload=structuredClone(payload);dailyPayload.error.details[1].violations[0].quotaId='GenerateRequestsPerDayPerProjectPerModel-FreeTier';
 const dailyService=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>new Response(JSON.stringify(dailyPayload),{status:429})});
 await assert.rejects(dailyService.analyze(input),e=>e.code==='DAILY_QUOTA');await assert.rejects(dailyService.analyze(input),e=>e.code==='DAILY_QUOTA');
});
test('wrong output shape, inferred physical extras and incomplete generations are rejected',async()=>{
 assert.throws(()=>validateAnalysis({...analysis,warmth:2}));const invalid=structuredClone(analysis);invalid.attributes.length_visual.value='골반';assert.throws(()=>validateAnalysis(invalid));
 const service=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(analysis)}]}}]}))});await assert.rejects(service.analyze(input),e=>e.code==='INVALID_ANALYSIS');
});
test('slow requests hit the time limit and explicit cancellation releases the service',async()=>{
 const delayedFetch=async(url,{signal})=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 const service=createVisionService({getKey:()=> 'test-key',fetchImpl:delayedFetch,timeoutMs:25});
 // A referenced timer keeps the fixture alive while AbortSignal's timer is unreferenced.
 const keepAlive=setInterval(()=>{},1000);
 try{await assert.rejects(service.analyze(input),e=>e.code==='TIMEOUT');const controller=new AbortController();const pending=service.analyze(input,{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.code==='CANCELLED');}finally{clearInterval(keepAlive);}
});
test('HTTP photo route connects to analysis, checks origin and blocks private files',async t=>{
 let calls=0;const vision=createVisionService({getKey:()=> 'test-key',fetchImpl:async()=>{calls++;return success();}});
 const server=createAppServer({root:path.dirname(fileURLToPath(import.meta.url)),store:{},readConfig:async()=>{},settings:()=>({geminiKeyPresent:true}),kick:()=>{},vision});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;
 const response=await fetch(origin+'/api/garment-analysis',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);const result=await response.json();assert.equal(result.draft.category,'top');assert.equal(calls,1);
 const trace=await fetch(origin+'/api/analysis-trace?request='+result.diagnostics.requestId).then(r=>r.json());assert.equal(trace.status,'success');assert.ok(trace.timeline.some(e=>e.stage==='request_body_finished'));assert.ok(trace.timeline.some(e=>e.stage==='gemini_headers_received'));assert.ok(trace.timeline.some(e=>e.stage==='response_finished'));assert.ok(!JSON.stringify(trace).includes('test-key'));assert.ok(!JSON.stringify(trace).includes(input.data));
 assert.equal((await fetch(origin+'/api/garment-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,403);assert.equal(calls,1);
 assert.equal((await fetch(origin+'/api/config').then(r=>r.json())).geminiKeyPresent,true);
 for(const file of ['.env','wardrobe-vision.mjs','vision-config.mjs','.weather-cache/regions.json'])assert.equal((await fetch(origin+'/'+file)).status,404);
});
