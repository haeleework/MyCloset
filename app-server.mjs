import {publicAssets} from './public-assets.mjs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {validId,safeError} from './operation-log.mjs';
import {sanitizeClientEvent} from './client-log.js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {places,nextCollectionTime} from './weather.mjs';
import {visionMessages,visionModelFallback} from './vision-config.mjs';
import {validationMessages} from './vision-format.js';
import {createTraceStore} from './analysis-trace.mjs';
import {cutoutMessages} from './cutout-messages.mjs';
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req,max=2000000){if(req.body!==undefined){const raw=Buffer.isBuffer(req.body)?req.body.toString('utf8'):typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(raw)>max)throw new Error('TOO_LARGE');return JSON.parse(raw);}let size=0,parts=[];for await(const part of req){size+=part.length;if(size>max)throw new Error('TOO_LARGE');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
const messages={NO_SAVED_FORECAST:'선택한 지역의 예보를 준비하고 있어요. 코디는 먼저 확인할 수 있어요.',STALE_FORECAST:'저장된 예보가 6시간 이상 지났어요. 새 자료를 준비하는 동안 날씨를 직접 확인해주세요.',KEY_REQUIRED:'기상청 인증키가 아직 설정되지 않았어요. .env 파일에 키를 넣고 저장해주세요.',KMA_KEY:'인증키 또는 해당 예보 서비스의 이용 권한을 확인해주세요.',KMA_CONNECTION:'새 예보를 가져오지 못했어요. 저장된 자료가 있으면 우선 사용합니다.',KMA_RESPONSE:'기상청 응답을 확인하지 못했어요. 날씨를 직접 확인해주세요.',NO_FORECAST:'저장된 발표 자료에 오늘 시간의 예보가 없어요. 날씨를 직접 확인해주세요.',TOO_LARGE:'파일이 너무 커요. 파일 크기를 확인해주세요.'};
const validIds=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=8&&ids.every(id=>places.some(p=>p.id===id));
export function createAppServer({root,store,readConfig,settings,kick,vision,cutouts,budget,recommendations=null,repository=null,observations=null,journal=null,holidays=null,holidayKick=()=>{},allowedHosts=[],productionOrigins=null,now=()=>new Date()}){
 const traces=createTraceStore(20,journal);
 const knownRoutes=new Set(['/api/recommendations','/api/wardrobe','/api/garment-analysis','/api/photo-cutout','/api/weather','/api/weather-regions','/api/config','/api/gemini-budget','/api/analysis-trace','/api/client-events','/api/log-health','/api/holidays','/api/holiday-refresh']);
 let clientWindow=Date.now(),clientCount=0;
 return http.createServer(async(req,res)=>{
  const proposed=req.headers['x-analysis-id']||req.headers['x-request-id'],requestId=validId(proposed)?proposed:randomUUID(),clock=performance.now();
  res.setHeader('X-Request-Id',requestId);
  const rawRoute=String(req.url||'').split('?')[0],route=knownRoutes.has(rawRoute)?rawRoute:rawRoute==='/'?'page':'static';
  const log=(event,details={})=>journal?.event(event,{route,elapsedMs:performance.now()-clock,...details},{requestId});
  log('http_request_started',{method:['GET','POST','HEAD','OPTIONS'].includes(req.method)?req.method:'OTHER'});
  res.once('finish',()=>log('http_response_finished',{httpStatus:res.statusCode,elapsedMs:performance.now()-clock}));
  res.once('close',()=>{if(!res.writableFinished)log('http_client_disconnected',{elapsedMs:performance.now()-clock});});
  req.once('error',error=>log('http_stream_failed',safeError(error)));
  try{
   const host=req.headers.host,port=req.socket.localPort;
   const origin=productionOrigins?productionOrigins.find(value=>{try{return new URL(value).protocol==='https:'&&new URL(value).host===host;}catch{return false;}}):'http://'+host;
   if(productionOrigins?!origin:!['127.0.0.1:'+port,'localhost:'+port,...allowedHosts.map(address=>address+':'+port)].includes(host)){json(res,403,{error:'허용된 앱 주소에서 이용해주세요.'});return;}
   const url=new URL(req.url,origin);
   if(req.method==='POST'){
    if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json')){json(res,403,{error:'이 앱 화면에서 다시 시도해주세요.'});return;}
    if(url.pathname==='/api/recommendations'){
     if(!recommendations){json(res,503,{code:'RECOMMENDATIONS_UNAVAILABLE',error:'추천 서버가 준비되지 않았어요.'});return;}
     try{const input=await body(req,2000000);const accessToken=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;const result=await recommendations.recommend(input,{accessToken});json(res,200,result);}
     catch(error){json(res,error.status||400,{code:/^[A-Z_]+$/.test(error.code||'')?error.code:'RECOMMENDATION_FAILED',error:'추천 조건이나 옷장 연결을 확인해주세요.'});}return;
    }
    if(url.pathname==='/api/wardrobe'){
     if(!repository){json(res,503,{code:'REPOSITORY_NOT_CONFIGURED'});return;}
     try{const input=await body(req,2000000);if(input.confirmUpload!==true){json(res,400,{code:'EXPLICIT_UPLOAD_REQUIRED'});return;}const accessToken=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;const result=await repository.upsertGarments({accessToken,wardrobe:input.wardrobe});json(res,200,result);}
     catch(error){json(res,error.status||400,{code:/^[A-Z_]+$/.test(error.code||'')?error.code:'WARDROBE_REQUEST_FAILED'});}return;
    }
    if(url.pathname==='/api/holiday-refresh'){holidayKick();json(res,202,{queued:true});return;}
    if(url.pathname==='/api/client-events'){
     if(Date.now()-clientWindow>60000){clientWindow=Date.now();clientCount=0;}
     if(++clientCount>120){json(res,429,{code:'LOG_RATE_LIMIT'});return;}
     const input=await body(req,64000);
     if(!Array.isArray(input.events)||input.events.length>40){json(res,400,{code:'INVALID_LOG_BATCH'});return;}
     const events=input.events.map(sanitizeClientEvent).filter(Boolean);
     for(const e of events)journal?.event('client_'+e.event,e.details,{requestId:e.requestId,sessionId:e.sessionId});
     json(res,202,{accepted:events.length,enabled:!!journal});return;
    }
    if(url.pathname==='/api/photo-cutout'){
     const controller=new AbortController();const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
     try{log('cutout_body_started');const input=await body(req,14500000);log('cutout_body_finished');if(!cutouts)throw new Error('PROCESSING_FAILED');const result=await cutouts.remove(input,{signal:controller.signal,mark:log});log('cutout_completed',{elapsedMs:performance.now()-clock,cached:!!result.cached});if(!res.destroyed)json(res,200,result);}
     catch(error){log('cutout_failed',safeError(error));const code=error.code||(error.message==='TOO_LARGE'?'IMAGE_TOO_LARGE':'PROCESSING_FAILED');if(!res.destroyed)json(res,error.status||502,{code,error:cutoutMessages[code]||cutoutMessages.PROCESSING_FAILED});}
     finally{res.off('close',cancel);}return;
    }
    if(url.pathname==='/api/garment-analysis'){
     const trace=traces.start(requestId);res.setHeader('X-Analysis-Id',trace.snapshot().requestId);const controller=new AbortController();
     const cancel=()=>{if(!res.writableEnded){trace.mark('analysis_client_disconnected');controller.abort();}};res.on('close',cancel);
     res.on('finish',()=>{trace.mark('response_finished');trace.finish(trace.snapshot().status);});
     try{trace.mark('request_body_started');const input=await body(req,14500000);trace.mark('request_body_finished',{bytes:typeof input.data==='string'?input.data.length:0});if(!vision)throw Object.assign(new Error('KEY_REQUIRED'),{code:'KEY_REQUIRED',status:503});const result=await vision.analyze(input,{signal:controller.signal,mark:(stage,details)=>trace.mark(stage,details)});trace.mark('response_prepared');trace.finish('success');json(res,200,{...result,diagnostics:trace.snapshot()});}
     catch(error){trace.mark('request_failed',safeError(error));trace.finish(error.code||(error.message==='TOO_LARGE'?'IMAGE_TOO_LARGE':'INVALID_INPUT'));if(!res.destroyed)json(res,error.status||(error.message==='TOO_LARGE'?413:502),{error:error.message==='TOO_LARGE'?'사진 분석에는 10MB 이하 파일을 선택해주세요.':(error.code==='INVALID_ANALYSIS'&&Object.hasOwn(validationMessages,error.validationIssue)?validationMessages[error.validationIssue]+' 수정한 내용은 유지돼요. 다시 분석하거나 직접 입력해주세요.':visionMessages[error.code]||visionMessages.UPSTREAM),code:error.code||'UPSTREAM',diagnostics:trace.snapshot()});}
     finally{res.off('close',cancel);}return;
    }
    if(url.pathname==='/api/weather-regions'){
     const input=await body(req);if(!validIds(input.places)){json(res,400,{error:'활동 지역을 선택해주세요.'});return;}
     await store.subscribe([...new Set(input.places)]);
     // Registration returns immediately. The worker owns external collection.
     kick({retry:input.retry===true});json(res,202,{registered:true});return;
    }
    json(res,404,{error:'요청을 찾지 못했어요.'});return;
   }
   if(req.method!=='GET'){json(res,405,{error:'지원하지 않는 요청이에요.'});return;}
   if(url.pathname==='/api/weather-observation'){
    const place=places.find(p=>p.id===url.searchParams.get('place'));
    if(!place){json(res,400,{code:'INVALID_PLACE'});return;}
    if(!observations){json(res,503,{code:'OBSERVATION_DISABLED',error:'관측 자료 연결이 활성화되지 않았어요.'});return;}
    try{json(res,200,await observations({place}));}catch{json(res,503,{code:'OBSERVATION_UNAVAILABLE',error:'관측 자료를 확인하지 못했어요.'});}return;
   }
   if(url.pathname==='/api/wardrobe'){
    if(!repository){json(res,503,{code:'REPOSITORY_NOT_CONFIGURED'});return;}
    try{const accessToken=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;json(res,200,await repository.listGarments({accessToken}));}catch(error){json(res,error.status||400,{code:/^[A-Z_]+$/.test(error.code||'')?error.code:'WARDROBE_REQUEST_FAILED'});}return;
   }
   if(url.pathname==='/api/holidays'){if(!holidays){json(res,503,{code:'HOLIDAY_UNAVAILABLE'});return;}json(res,200,await holidays.snapshot());return;}
   if(url.pathname==='/api/log-health'){await journal?.flush();json(res,200,journal?.health()||{enabled:false});return;}
   if(url.pathname==='/api/gemini-budget'){try{if(!budget)throw new Error();json(res,200,await budget.snapshot());}catch(error){log('budget_read_failed',safeError(error));json(res,503,{code:'BUDGET_UNAVAILABLE',error:'테스트 비용 기록을 확인하지 못해 Gemini 호출을 중단했어요.'});}return;}
   if(url.pathname==='/api/analysis-trace'){await journal?.flush();const trace=await traces.saved(url.searchParams.get('request'));json(res,trace?200:404,trace||{error:'해당 분석 시간 기록이 없어요.'});return;}
   if(url.pathname==='/api/config'){await readConfig();const config=settings();json(res,200,{geminiKeyPresent:!!config.geminiKeyPresent,geminiEnabled:config.geminiEnabled===true,features:config.features||null,visionModel:visionModelFallback,weatherKeyPresent:config.keyPresent,weatherProvider:config.provider,recommendationMode:recommendations?.mode||'local',supabase:{enabled:repository?.mode==='supabase',url:repository?.mode==='supabase'?config.supabaseUrl??null:null,...(repository?.mode==='supabase'&&config.supabasePublishableKey?{publishableKey:config.supabasePublishableKey,authMode:config.supabaseAuthMode||'account'}:{})},places:places.filter(p=>!p.town),regionCatalog:'region-data.js',weatherSchedule:{hours:[2,5,8,11,14,17,20,23],delayMinutes:15,nextUpdateAt:nextCollectionTime(now())}});return;}
   if(url.pathname==='/api/weather'){
    await readConfig();const config=settings(),ids=[...new Set((url.searchParams.get('places')||'').split(','))];
    if(!validIds(ids)){json(res,400,{error:'활동 지역을 선택해주세요.'});return;}
    const selected=ids.map(id=>places.find(p=>p.id===id)),currentTime=now();
    await store.prepare?.(selected,config.provider);
    const results=await Promise.allSettled(selected.map(place=>store.saved(place,config.provider,{now:currentTime})));
    const forecasts=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]),missingPlaces=results.flatMap((r,i)=>r.status==='rejected'?[selected[i].name]:[]);
    log('weather_cache_read',{count:forecasts.length,failed:missingPlaces.length,regionCount:ids.length});for(const r of results)if(r.status==='rejected')log('weather_cache_unavailable',safeError(r.reason));
    const nextUpdateAt=nextCollectionTime(currentTime);
    if(!forecasts.length){
     const code=results[0].reason.message,failure=store.failures.get(config.provider+'-'+ids[0]);
     const pending=config.keyPresent&&!failure&&['NO_SAVED_FORECAST','STALE_FORECAST'].includes(code);
     json(res,pending?202:503,{pending,error:messages[config.keyPresent?(failure?.code||code):'KEY_REQUIRED']||'예보를 확인하지 못했어요.',missingPlaces,nextUpdateAt});return;
    }
    json(res,200,{...forecasts[0],forecasts,missingPlaces,requestedPlaceIds:ids,nextUpdateAt});return;
   }
   const allowed=new Set(publicAssets);
   const file=decodeURIComponent(url.pathname.slice(1))||'index.html';if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
   const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(await readFile(path.join(root,file)));
  }catch(error){log('http_handler_failed',safeError(error));if(res.headersSent){res.destroy();return;}json(res,error.message==='TOO_LARGE'?413:400,{error:error.message==='TOO_LARGE'&&req.url==='/api/garment-analysis'?'사진 분석에는 10MB 이하 파일을 선택해주세요.':messages[error.message]||'파일이나 응답을 읽지 못했어요. 입력 내용을 확인해주세요.'});}
 });
}
