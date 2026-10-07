import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {subscribe,unsubscribe} from 'node:diagnostics_channel';
import {visionModel,visionPrompt,visionTimeoutMs,parseAnalysisText,analysisDraft,AnalysisValidationError} from './vision-format.js';
import {safeError} from './operation-log.mjs';
import {visionRequestSchema} from './vision-request-schema.js';
export const maxImageBytes=10*1024*1024;
export class VisionError extends Error{constructor(code,status=502){super(code);this.code=code;this.status=status;}}
export function providerFailureInfo(payload,headers){
 const info={};const status=payload?.error?.status;if(['RESOURCE_EXHAUSTED','UNAVAILABLE','INVALID_ARGUMENT','PERMISSION_DENIED','UNAUTHENTICATED'].includes(status))info.providerStatus=status;
 const retry=(payload?.error?.details||[]).find(d=>d['@type']==='type.googleapis.com/google.rpc.RetryInfo')?.retryDelay;
 const seconds=typeof retry==='string'&&/^\d+(\.\d+)?s$/.test(retry)?Number(retry.slice(0,-1)):Number(headers.get('retry-after'));
 if(Number.isFinite(seconds)&&seconds>0&&seconds<=3600)info.retryAfterMs=Math.ceil(seconds*1000);
 const violations=(payload?.error?.details||[]).find(d=>d['@type']==='type.googleapis.com/google.rpc.QuotaFailure')?.violations||[];
 const message=String(payload?.error?.message||'').toLowerCase();
 if(/overload|high demand|capacity/.test(message))info.reason='provider_capacity';
 else if(/decode.*preempt/.test(message))info.reason='decode_preempted';
 else if(/unavailable/.test(message))info.reason='provider_unavailable';
 info.quotaIds=violations.map(v=>v.quotaId).filter(v=>typeof v==='string'&&/^[A-Za-z0-9_.\/-]{1,160}$/.test(v)).slice(0,5);
 return info;
}
export const visionMessages={KEY_REQUIRED:'Gemini 키가 설정되지 않았어요. 설정 파일을 확인해주세요.',INVALID_IMAGE:'JPEG, PNG 또는 WebP 사진을 선택해주세요.',IMAGE_TOO_LARGE:'사진 분석에는 10MB 이하 파일을 선택해주세요.',INVALID_ANALYSIS:'분석 결과를 확인하지 못했어요. 다시 분석하거나 직접 입력해주세요.',BUSY:'다른 사진을 분석 중이에요. 잠시 후 다시 눌러주세요.',QUOTA:'Gemini 사용 한도에 도달했어요. 잠시 후 다시 시도하거나 직접 입력해주세요.',DAILY_QUOTA:'Gemini 무료 이용의 하루 요청 한도에 도달했어요. 한도가 초기화된 뒤 다시 분석해주세요. 직접 입력해서 등록할 수도 있어요.',UPSTREAM:'Gemini가 일시적으로 응답하지 않아요. 잠시 후 다시 시도하거나 직접 입력해주세요.',AUTH:'Gemini 키나 모델 사용 권한을 확인해주세요.',TIMEOUT:'분석 시간이 길어져 중단했어요. 잠시 후 다시 시도해주세요.',CANCELLED:'사진 분석을 취소했어요.'};
export function decodeImage(input){
 if(!input||!['image/jpeg','image/png','image/webp'].includes(input.mimeType)||typeof input.data!=='string'||!input.data.length)throw new VisionError('INVALID_IMAGE',400);
 if(input.data.length>Math.ceil(maxImageBytes/3)*4)throw new VisionError('IMAGE_TOO_LARGE',413);
 if(input.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))throw new VisionError('INVALID_IMAGE',400);
 const bytes=Buffer.from(input.data,'base64');
 if(bytes.length>maxImageBytes)throw new VisionError('IMAGE_TOO_LARGE',413);
 const valid=input.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:input.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.length>12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid)throw new VisionError('INVALID_IMAGE',400);
 return {bytes,mimeType:input.mimeType,sha256:createHash('sha256').update(bytes).digest('hex')};
}
Object.assign(visionMessages,{TEST_BUDGET_LIMIT:'테스트 예산에서 다음 요청 비용을 안전하게 확보할 수 없어 분석을 중단했어요. 직접 입력으로 등록할 수 있어요.',BUDGET_UNAVAILABLE:'테스트 비용 기록을 확인하지 못해 분석을 중단했어요.',BUDGET_PRICE_EXPIRED:'Gemini 요금 적용 기간이 지나 비용 기준을 확인해야 해요. 분석을 잠시 중단했어요.'});
export function createVisionService({getKey,fetchImpl=fetch,wait=pause,timeoutMs=visionTimeoutMs,budget=null}){
 let busy=false,cooldownUntil=0,cooldownCode='QUOTA',lastCallAt=null;
 const hash=value=>createHash('sha256').update(value).digest('hex');
 return {async analyze(input,{signal,mark=()=>{}}={}){
  mark('image_validation_started');const image=decodeImage(input);mark('image_validation_finished',{bytes:image.bytes.length,mimeType:image.mimeType,imageSha256:image.sha256});
  mark('gemini_configuration',{model:visionModel,promptSha256:hash(visionPrompt),schemaSha256:hash(JSON.stringify(visionRequestSchema)),promptChars:visionPrompt.length,schemaBytes:Buffer.byteLength(JSON.stringify(visionRequestSchema)),thinkingLevel:'LOW',maxOutputTokens:4096,timeoutMs});
  if(busy){mark('analysis_busy');throw new VisionError('BUSY',409);}
  if(Date.now()<cooldownUntil){mark('quota_cooldown',{retryAfterMs:cooldownUntil-Date.now()});throw new VisionError(cooldownCode,429);}
  busy=true;const start=performance.now(),requestedAt=new Date().toISOString();let activeAttempt=0,budgetId=null;
  const related=request=>String(request?.origin)==='https://generativelanguage.googleapis.com'&&request?.path==='/v1beta/models/'+visionModel+':generateContent';
  const socketReady=({request})=>{if(related(request))mark('gemini_socket_ready',{attempt:activeAttempt});};
  const bodySent=({request})=>{if(related(request))mark('gemini_upload_finished',{attempt:activeAttempt});};
  subscribe('undici:client:sendHeaders',socketReady);subscribe('undici:request:bodySent',bodySent);
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  try{
   mark('config_read_started');const key=await getKey();mark('config_read_finished',{keyPresent:!!key});if(!key)throw new VisionError('KEY_REQUIRED',503);
   const body={contents:[{role:'user',parts:[{text:visionPrompt},{inlineData:{mimeType:image.mimeType,data:input.data}}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:visionRequestSchema,thinkingConfig:{thinkingLevel:'LOW'},maxOutputTokens:4096}};
   for(let attempt=0;attempt<2;attempt++){
    activeAttempt=attempt+1;
    mark('gemini_payload_started',{attempt:attempt+1});const serialized=JSON.stringify(body);mark('gemini_payload_finished',{attempt:attempt+1,bytes:Buffer.byteLength(serialized)});
    if(combined.aborted)throw combined.reason;
    if(budget){mark('budget_reserve_started');budgetId=await budget.reserve();mark('budget_reserve_finished');}
    mark('gemini_request_started',{attempt:attempt+1,...(lastCallAt===null?{}:{gapMs:Date.now()-lastCallAt})});lastCallAt=Date.now();
    const response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/'+visionModel+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:serialized,signal:combined});
    mark('gemini_headers_received',{attempt:attempt+1,httpStatus:response.status});
    if(!response.ok){
     // Only allowlisted status/quota identifiers and delay numbers leave this block.
     // Never return provider messages, project identifiers or authentication data.
     mark('gemini_error_body_started',{attempt:attempt+1});let failure={};try{failure=providerFailureInfo(await response.json(),response.headers);}catch(error){mark('gemini_error_body_invalid',{attempt:attempt+1,...safeError(error)});}mark('gemini_error_body_finished',{attempt:attempt+1});
     if(budget){const id=budgetId;budgetId=null;await budget.finish(id,null,{httpStatus:response.status});}
     mark('gemini_error_received',{attempt:attempt+1,...failure});
     if(response.status===429){cooldownUntil=Date.now()+Math.max(60000,failure.retryAfterMs||0);cooldownCode=failure.quotaIds?.some(id=>id.includes('PerDay'))?'DAILY_QUOTA':'QUOTA';}
     if(attempt===0&&response.status===503){mark('retry_wait_started',{attempt:attempt+1,retryAfterMs:Math.max(2000,failure.retryAfterMs||0)});await wait(Math.max(2000,failure.retryAfterMs||0),undefined,{signal:combined});mark('retry_wait_finished',{attempt:attempt+1});continue;}
     throw new VisionError([401,403].includes(response.status)?'AUTH':response.status===429?cooldownCode:'UPSTREAM',response.status===429?429:502);
    }
    mark('gemini_body_started',{attempt:attempt+1});const payload=await response.json(),candidate=payload.candidates?.[0];mark('gemini_body_finished',{attempt:attempt+1,finishReason:candidate?.finishReason||'MISSING'});
    mark('gemini_usage',{attempt:attempt+1,modelVersion:payload.modelVersion,inputTokens:payload.usageMetadata?.promptTokenCount,outputTokens:payload.usageMetadata?.candidatesTokenCount,thinkingTokens:payload.usageMetadata?.thoughtsTokenCount,totalTokens:payload.usageMetadata?.totalTokenCount});
    if(budget){const id=budgetId;budgetId=null;await budget.finish(id,payload.usageMetadata,{httpStatus:response.status});mark('budget_cost_recorded');}
    mark('output_validation_started');let analysis;
    try{
     if(candidate?.finishReason!=='STOP')throw new AnalysisValidationError('INCOMPLETE_OUTPUT');
     analysis=parseAnalysisText((Array.isArray(candidate.content?.parts)?candidate.content.parts:[]).filter(p=>p&&!p.thought&&typeof p.text==='string').map(p=>p.text).join(''));
    }catch(error){
     const failure=new VisionError('INVALID_ANALYSIS');
     if(error instanceof AnalysisValidationError){failure.validationIssue=error.validationIssue;failure.validationPath=error.validationPath;}
     mark('output_validation_failed',{validationIssue:failure.validationIssue,validationPath:failure.validationPath});throw failure;
    }
    mark('output_validation_finished');return {model:visionModel,requestedAt,elapsedMs:Math.round(performance.now()-start),attempts:attempt+1,analysis,draft:analysisDraft(analysis),usage:payload.usageMetadata||null,sourceImage:{sha256:image.sha256,bytes:image.bytes.length,mimeType:image.mimeType},userReview:{status:'pending'},physicalAttributes:{warmth:null,waterproof:null,stretch:null,comfort:null,wearerFit:null,composition:null}};
   }
  }catch(error){mark('analysis_failed',{...safeError(error),...(error.cause?{errorCode:safeError(error.cause).errorCode}:{}),reason:combined.aborted?(signal?.aborted?'client_cancelled':'deadline_exceeded'):'processing_failed',attempt:activeAttempt});if(budgetId){const id=budgetId;budgetId=null;try{await budget.finish(id,null);}catch{throw new VisionError('BUDGET_UNAVAILABLE',503);}}if(['TEST_BUDGET_LIMIT','BUDGET_UNAVAILABLE','BUDGET_PRICE_EXPIRED'].includes(error.code))throw new VisionError(error.code,error.status||503);if(error instanceof VisionError)throw error;if(combined.aborted)throw new VisionError(signal?.aborted?'CANCELLED':'TIMEOUT',504);throw new VisionError('UPSTREAM');}
  finally{unsubscribe('undici:client:sendHeaders',socketReady);unsubscribe('undici:request:bodySent',bodySent);busy=false;}
 }};
}
