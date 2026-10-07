import {Worker} from 'node:worker_threads';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {decodeImage} from './wardrobe-vision.mjs';
export const cutoutVersion='isnet-small-1280-square1024-v1';
export class CutoutError extends Error{constructor(code,status=502){super(code);this.code=code;this.status=status;}}
export const cutoutMessages={BUSY:'다른 사진의 배경을 제거하고 있어요. 잠시 후 다시 눌러주세요.',NO_FOREGROUND:'옷을 배경에서 분리하지 못했어요. 원본을 사용하거나 단색 배경에서 다시 찍어주세요.',PROCESSING_FAILED:'배경 제거를 완료하지 못했어요. 원본 사진으로 등록할 수 있어요.',TIMEOUT:'배경 제거 시간이 길어져 중단했어요. 원본으로 등록하거나 다시 시도해주세요.',CANCELLED:'배경 제거를 취소했어요.',INVALID_IMAGE:'배경 제거는 JPEG·PNG·WebP 사진을 지원해요.',IMAGE_TOO_LARGE:'배경 제거에는 10MB 이하 사진을 선택해주세요.'};
export function createWorkerProcessor(timeoutMs=60000){
 let worker=null;
 return {async process(bytes,{signal}={}){
  if(signal?.aborted)throw new CutoutError('CANCELLED',499);
  if(!worker){worker=new Worker(new URL('./cutout-worker.mjs',import.meta.url));const created=worker;created.on('error',()=>{if(worker===created)worker=null;});created.on('exit',()=>{if(worker===created)worker=null;});}
  const current=worker,id=randomUUID();
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);current.off('message',message);current.off('error',failed);current.off('exit',exited);};
   const stop=code=>{cleanup();if(worker===current)worker=null;current.terminate().catch(()=>{});reject(new CutoutError(code,code==='CANCELLED'?499:504));};
   const abort=()=>stop('CANCELLED'),failed=()=>stop('PROCESSING_FAILED'),exited=()=>failed();
   const message=value=>{if(value.id!==id)return;cleanup();if(value.error)reject(new CutoutError(value.error));else resolve({...value.result,png:Buffer.from(value.result.png)});};
   const timer=setTimeout(()=>stop('TIMEOUT'),timeoutMs);
   current.on('message',message);current.on('error',failed);current.on('exit',exited);signal?.addEventListener('abort',abort,{once:true});current.postMessage({id,bytes});
  });
 },async close(){const current=worker;worker=null;if(current)await current.terminate();}};
}
export function createCutoutService({cacheDir,processor=createWorkerProcessor()}){
 let busy=false;
 return {async remove(input,{signal,mark=()=>{}}={}){
  mark('cutout_validation_started');const image=decodeImage(input);mark('cutout_validation_finished',{bytes:image.bytes.length,mimeType:image.mimeType,imageSha256:image.sha256});if(signal?.aborted)throw new CutoutError('CANCELLED',499);
  const cacheKey=createHash('sha256').update(cutoutVersion+image.sha256).digest('hex'),file=path.join(cacheDir,cacheKey+'.json');
  const start=performance.now();
  mark('cutout_cache_started');try{const cached=JSON.parse(await readFile(file,'utf8'));if(cached.version===cutoutVersion&&cached.sourceSha256===image.sha256){mark('cutout_cache_hit',{cached:true});return {...cached,cached:true,elapsedMs:Math.round(performance.now()-start)};}}catch{}
  mark('cutout_cache_miss',{cached:false});if(busy)throw new CutoutError('BUSY',409);busy=true;
  try{
   mark('cutout_model_started');const result=await processor.process(image.bytes,{signal});mark('cutout_model_finished',{width:result.width,height:result.height});if(signal?.aborted)throw new CutoutError('CANCELLED',499);
   const record={version:cutoutVersion,mimeType:'image/png',data:result.png.toString('base64'),sourceSha256:image.sha256,width:result.width,height:result.height,elapsedMs:Math.round(performance.now()-start),foregroundRatio:result.foregroundRatio,cached:false};
   mark('cutout_save_started');await mkdir(cacheDir,{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(record),{flag:'wx'});await rename(temporary,file);mark('cutout_save_finished');return record;
  }finally{busy=false;}
 },close:()=>processor.close?.()};
}
