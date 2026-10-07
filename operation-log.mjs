import {mkdir,appendFile,readdir,readFile} from 'node:fs/promises';
import {mkdirSync,appendFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
export const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const numbers=new Set(['clientAtMs','sequence','elapsedMs','bytes','attempt','httpStatus','retryAfterMs','gapMs','timeoutMs','maxOutputTokens','promptChars','schemaBytes','inputTokens','outputTokens','thinkingTokens','totalTokens','count','width','height','line','column','pending','rssBytes','heapBytes','uptimeSeconds','failed','dropped','regionCount']);
const booleans=new Set(['keyPresent','cached','online','secureContext','saved','hasPhoto','hasAnalysis','hasCutout','outfitReady']);
const identifiers=new Set(['model','modelVersion','thinkingLevel','providerStatus','finishReason','errorCode','errorName','method','route','status','version','source','reason','file','origin','validationIssue','validationPath']);
const hashes=new Set(['imageSha256','promptSha256','schemaSha256','errorFingerprint']);
export function safeDetails(input={}){
 const result={};
 for(const [key,value] of Object.entries(input)){
  if(numbers.has(key)&&Number.isFinite(value)&&value>=0&&value<=1e13)result[key]=Math.round(value*100)/100;
  else if(booleans.has(key)&&typeof value==='boolean')result[key]=value;
  else if(identifiers.has(key)&&typeof value==='string'&&/^[A-Za-z0-9_.:/-]{1,160}$/.test(value))result[key]=value;
  else if(hashes.has(key)&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))result[key]=value;
  else if(key==='mimeType'&&['image/jpeg','image/png','image/webp'].includes(value))result[key]=value;
  else if(key==='quotaIds'&&Array.isArray(value))result[key]=value.filter(v=>typeof v==='string'&&/^[A-Za-z0-9_.\/-]{1,160}$/.test(v)).slice(0,5);
 }
 return result;
}
export function safeError(error){
 const known=new Set(['KEY_REQUIRED','INVALID_IMAGE','IMAGE_TOO_LARGE','INVALID_ANALYSIS','BUSY','QUOTA','DAILY_QUOTA','UPSTREAM','AUTH','TIMEOUT','CANCELLED','TEST_BUDGET_LIMIT','BUDGET_UNAVAILABLE','BUDGET_PRICE_EXPIRED','PROCESSING_FAILED','NO_FOREGROUND','TOO_LARGE','KMA_KEY','KMA_CONNECTION','KMA_RESPONSE','NO_FORECAST','NO_SAVED_FORECAST','STALE_FORECAST','HOLIDAY_AUTH','HOLIDAY_CONNECTION','HOLIDAY_RESPONSE','HOLIDAY_INCOMPLETE','HOLIDAY_KEY_REQUIRED','HOLIDAY_SAVE_FAILED','INVALID_PLACE','ENOENT','EACCES','ENOSPC','EADDRINUSE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET']);
 const code=error?.code||error?.message;
 const names=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','QuotaExceededError','SecurityError','NotAllowedError','InvalidStateError','DataCloneError','UnknownError','VersionError','ConstraintError','TransactionInactiveError','NotFoundError']);
 const out={errorCode:known.has(code)?code:'UNKNOWN',errorName:names.has(error?.name)?error.name:'Error',errorFingerprint:createHash('sha256').update(String(error?.code||'')+'|'+String(error?.message||'')).digest('hex')};
 // Keep source locations only, never raw stack/message/paths or arguments.
 const location=String(error?.stack||'').match(/(?:\/|\\)([A-Za-z0-9_-]+\.(?:m?js)):(\d+):(\d+)/);
 if(location){out.file=location[1];out.line=Number(location[2]);out.column=Number(location[3]);}
 return out;
}
export function createOperationLog(directory,{version='0.10.0',maxFileBytes=10*1024*1024,maxPending=1000}={}){
 const instanceId=randomUUID();let queue=Promise.resolve(),pending=0,failed=0,dropped=0,written=0,part=0,size=0,day='',eventSequence=0;
 const fileFor=()=>{const next=new Date().toISOString().slice(0,10);if(next!==day){day=next;part=0;size=0;}return path.join(directory,day+'_'+instanceId+'_'+part+'.jsonl');};
 const record=(event,details={},context={})=>({logVersion:1,at:new Date().toISOString(),instanceId,eventSequence:++eventSequence,version,event,...(validId(context.requestId)?{requestId:context.requestId}:{}),...(validId(context.sessionId)?{sessionId:context.sessionId}:{}),details:safeDetails(details)});
 const failure=()=>{failed++;if(failed===1)console.error('OPERATION_LOG_WRITE_FAILED: 운영 로그를 저장하지 못했습니다. /api/log-health에서 확인하세요.');};
 return {
  instanceId,
  event(event,details={},context={}){
   if(!/^[a-z][a-z0-9_]{0,79}$/.test(event))return;
   if(pending>=maxPending){dropped++;return;}
   const line=JSON.stringify(record(event,details,context))+'\n';pending++;
   queue=queue.then(async()=>{await mkdir(directory,{recursive:true});let file=fileFor();if(size+Buffer.byteLength(line)>maxFileBytes){part++;size=0;file=fileFor();}await appendFile(file,line,{mode:0o600});size+=Buffer.byteLength(line);written++;}).catch(failure).finally(()=>pending--);
  },
  emergency(event,details={}){try{mkdirSync(directory,{recursive:true});appendFileSync(path.join(directory,'fatal_'+instanceId+'.jsonl'),JSON.stringify(record(event,details))+'\n',{mode:0o600});}catch{failure();}},
  async flush(){await queue;},
  health(){return {enabled:true,saved:failed===0&&dropped===0,pending,failed,dropped,count:written,instanceId};},
  async trace(requestId){
   if(!validId(requestId))return null;
   let files=[];try{files=(await readdir(directory)).filter(f=>/^\d{4}-\d{2}-\d{2}_[a-f0-9-]+_\d+\.jsonl$/.test(f)).sort().reverse();}catch{return null;}
   // Disk lookup is for diagnostics, with explicit limits. Old logs remain on disk.
   let scanned=0,matched=[];for(const file of files.slice(0,40)){
    let content;try{content=await readFile(path.join(directory,file),'utf8');}catch{continue;}
    scanned+=Buffer.byteLength(content);if(scanned>40*1024*1024)break;
    const records=content.split('\n').flatMap(line=>{try{const r=JSON.parse(line);return r.requestId===requestId?[r]:[];}catch{return [];}});
    matched.push(...records);
   }
   matched.sort((a,b)=>a.at.localeCompare(b.at)||(a.instanceId===b.instanceId?a.eventSequence-b.eventSequence:0));const started=matched.find(r=>r.event==='request_received');if(!started)return null;
   const completed=matched.filter(r=>r.event==='analysis_completed').at(-1);
   return {requestId,startedAt:started.at,status:completed?.details.status||'incomplete',elapsedMs:completed?.details.elapsedMs,timeline:matched.filter(r=>r.event!=='analysis_completed'&&!r.event.startsWith('client_')).map(r=>({stage:r.event,...r.details}))};
  }
 };
}
