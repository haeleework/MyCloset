// No image, clothing name, profile, schedule, URL query, raw message or stack is sent.
export function newClientId(api=crypto){
 if(api.randomUUID)return api.randomUUID();
 // randomUUID is unavailable on ordinary HTTP Wi-Fi mobile URLs.
 const b=api.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const h=Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
export const clientEvents=new Set(['screen_opened','storage_open_started','storage_open_finished','storage_open_failed','storage_read_started','storage_read_finished','storage_read_failed','storage_write_started','storage_write_finished','storage_write_failed','app_started','app_ready','runtime_error','unhandled_rejection','resource_failed','http_started','http_finished','http_failed','storage_started','storage_finished','storage_failed','photo_selected','photo_rejected','photo_metadata_started','photo_metadata_finished','photo_metadata_failed','photo_preview_failed','file_read_started','file_read_finished','file_read_failed','client_started','client_payload_started','client_payload_finished','fetch_started','fetch_headers_received','client_json_started','client_json_finished','ui_apply_started','ui_apply_finished','client_failed','client_cancelled','registration_started','registration_finished','registration_failed','registration_rejected','recommendation_started','recommendation_finished','recommendation_failed','page_hidden','cutout_client_started','cutout_ui_applied','cutout_client_failed','analysis_input_selected']);
const numbers=new Set(['clientAtMs','sequence','elapsedMs','bytes','httpStatus','count','width','height','line','column']);
const booleans=new Set(['online','secureContext','hasPhoto','hasAnalysis','hasCutout','outfitReady']);
const names=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','QuotaExceededError','SecurityError','NotAllowedError','InvalidStateError','DataCloneError','UnknownError','VersionError','ConstraintError','TransactionInactiveError','NotFoundError']);
const sources=new Set(['today','closet','profile','purchase','setup','camera','gallery','real','demo','analysis','cutout','forecast','config','budget','trace','other','original']);
const files=new Set(['app.js','client-log.js','vision-format.js','engine.js','conditions.js','learning.js','persona.js','onboarding.js','user-settings.js']);
const routes=new Set(['/api/garment-analysis','/api/photo-cutout','/api/weather','/api/weather-regions','/api/config','/api/gemini-budget','/api/analysis-trace']);
export function sanitizeClientEvent(entry){
 if(!clientEvents.has(entry?.event))return null;
 const details={};for(const [key,v] of Object.entries(entry.details||{})){
  if(numbers.has(key)&&Number.isFinite(v)&&v>=0&&v<=1e13)details[key]=v;
  else if(booleans.has(key)&&typeof v==='boolean')details[key]=v;
  else if(key==='errorName'&&names.has(v))details[key]=v;
  else if(key==='source'&&sources.has(v))details[key]=v;
  else if(key==='route'&&routes.has(v))details[key]=v;
  else if(key==='file'&&files.has(v))details[key]=v;
  else if(key==='mimeType'&&['image/jpeg','image/png','image/webp'].includes(v))details[key]=v;
 }
 const validId=v=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
 return {event:entry.event,details,...(validId(entry.requestId)?{requestId:entry.requestId}:{}),...(validId(entry.sessionId)?{sessionId:entry.sessionId}:{})};
}
export function installClientLog(win=window){
 const nativeFetch=win.fetch.bind(win),sessionId=newClientId();let queue=[],sending=false,failed=0,dropped=0,sequence=0;
 const emit=(event,details={},requestId)=>{const item=sanitizeClientEvent({event,details:{online:navigator.onLine,...details,clientAtMs:Date.now(),sequence:++sequence},requestId,sessionId});if(!item)return;if(queue.length>=200){dropped++;return;}queue.push(item);};
 const flush=async()=>{
  if(sending||!queue.length||!navigator.onLine)return;
  sending=true;const batch=queue.splice(0,40);
  try{const response=await nativeFetch('/api/client-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),signal:AbortSignal.timeout(4000),keepalive:true});if(!response.ok)throw new Error();}
  catch{failed++;queue.unshift(...batch);if(queue.length>200){dropped+=queue.length-200;queue.length=200;}}
  finally{sending=false;}
 };
 win.fetch=async(input,options={})=>{
  let route;try{const url=new URL(typeof input==='string'?input:input.url,win.location.href);if(url.origin===win.location.origin&&routes.has(url.pathname))route=url.pathname;}catch{}
  if(!route)return nativeFetch(input,options);
  const requestId=new Headers(options.headers||input?.headers).get('X-Analysis-Id')||newClientId(),start=performance.now();
  emit('http_started',{route},requestId);
  try{const headers=new Headers(options.headers||input?.headers);if(requestId)headers.set('X-Request-Id',requestId);const response=await nativeFetch(input,{...options,headers});emit('http_finished',{route,httpStatus:response.status,elapsedMs:performance.now()-start},requestId);return response;}
  catch(error){emit('http_failed',{route,errorName:error.name,elapsedMs:performance.now()-start},requestId);throw error;}
 };
 win.addEventListener('error',e=>{emit(e.error?'runtime_error':'resource_failed',{errorName:e.error?.name||'Error',line:e.lineno||0,column:e.colno||0,file:String(e.filename||'').split('/').at(-1)});},true);
 win.addEventListener('unhandledrejection',e=>emit('unhandled_rejection',{errorName:e.reason?.name||'Error'}));
 win.addEventListener('online',flush);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){emit('page_hidden');const batch=queue.splice(0,40);if(batch.length&&!navigator.sendBeacon('/api/client-events',new Blob([JSON.stringify({events:batch})],{type:'application/json'})))queue.unshift(...batch);}});
 setInterval(flush,5000);
 emit('app_started',{secureContext:win.isSecureContext,width:win.innerWidth,height:win.innerHeight});
 return {event:emit,flush,health:()=>({pending:queue.length,failed,dropped,sessionId})};
}
