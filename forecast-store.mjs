import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {safeError} from './operation-log.mjs';
import {randomUUID} from 'node:crypto';
import {collectionBase,normalizeForecast,places} from './weather.mjs';
export const MAX_STALE_MS=6*3600000;
const RETRY_DELAY_MS=5*60000;
const stamp=base=>String(base?.base_date||'')+String(base?.base_time||'');
const dateOf=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(now);
const itemKey=i=>[i.fcstDate,i.fcstTime,i.category].join('|');
const itemValue=i=>String(i.fcstValue??'').trim();
export function compareForecasts(previous=[],latest=[]){
 const old=new Map(previous.map(i=>[itemKey(i),itemValue(i)])),next=new Map(latest.map(i=>[itemKey(i),itemValue(i)]));
 let added=0,updated=0,removed=0;
 for(const [key,value] of next){if(!old.has(key))added++;else if(old.get(key)!==value)updated++;}
 for(const key of old.keys())if(!next.has(key))removed++;
 return {added,updated,removed};
}
export class ForecastStore{
 constructor(directory,collector){this.directory=path.resolve(directory);this.collector=collector;this.pending=new Map();this.failures=new Map();this.subscriptionWrite=Promise.resolve();}
 file(place,provider){if(!places.some(p=>p.id===place.id)||!['data','hub'].includes(provider))throw new Error('INVALID_PLACE');return path.join(this.directory,provider+'-'+place.id+'.json');}
 async read(place,provider){try{const data=JSON.parse(await readFile(this.file(place,provider),'utf8'));if(data.placeId!==place.id||data.provider!==provider||!Array.isArray(data.items)||!Number.isFinite(Date.parse(data.fetchedAt)))return null;return data;}catch{return null;}}
 async atomicSave(target,data){await mkdir(this.directory,{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(data),{flag:'wx'});await rename(temporary,target);}
 async save(record,place,provider,previous){
  // Authentication and request URLs are never included in persisted records.
  const safe={provider,placeId:place.id,base:record.base,items:record.items,fetchedAt:record.fetchedAt,changes:compareForecasts(previous?.items,record.items)};
  if(previous)safe.previous={provider,placeId:place.id,base:previous.base,items:previous.items,fetchedAt:previous.fetchedAt};
  await this.atomicSave(this.file(place,provider),safe);return safe;
 }
 async subscribe(ids){
  if(!Array.isArray(ids)||ids.some(id=>!places.some(p=>p.id===id)))throw new Error('INVALID_PLACE');
  this.subscriptionWrite=this.subscriptionWrite.catch(()=>{}).then(async()=>{
   let old=[];try{old=JSON.parse(await readFile(path.join(this.directory,'regions.json'),'utf8'));}catch{}
   const active=[...new Set([...(Array.isArray(old)?old:[]),...ids])].filter(id=>places.some(p=>p.id===id));
   await this.atomicSave(path.join(this.directory,'regions.json'),active);
  });
  return this.subscriptionWrite;
 }
 async activePlaces(provider){
  let files=[],ids=[];try{files=await readdir(this.directory);}catch{}
  try{ids=JSON.parse(await readFile(path.join(this.directory,'regions.json'),'utf8'));}catch{}
  return places.filter(p=>files.includes(provider+'-'+p.id+'.json')||Array.isArray(ids)&&ids.includes(p.id));
 }
 weather(record,place,now){
  let selected=record,weather;
  try{weather=normalizeForecast(record.items,dateOf(now));}
  catch(error){if(error.message!=='NO_FORECAST'||!record.previous)throw error;selected=record.previous;weather=normalizeForecast(selected.items,dateOf(now));}
  if(now.getTime()-Date.parse(selected.fetchedAt)>MAX_STALE_MS)throw new Error('STALE_FORECAST');
  const id=record.provider+'-'+place.id,stale=stamp(record.base)<stamp(collectionBase(now));
  return {...weather,placeId:place.id,place:place.name,base:selected.base,fetchedAt:selected.fetchedAt,cacheSource:'saved',stale,refreshStatus:this.pending.has(id)?'updating':stale&&this.failures.has(id)?'failed':stale?'waiting':'current',changes:record.changes||null};
 }
 async saved(place,provider,{now=new Date()}={}){
  // Read-only path for outfit requests; never invokes the external collector.
  const record=await this.read(place,provider);if(!record)throw new Error('NO_SAVED_FORECAST');
  return this.weather(record,place,now);
 }
 async refresh(place,provider,{now=new Date(),retry=false,mark=()=>{}}={}){
  const id=provider+'-'+place.id;
  if(this.pending.has(id))return this.pending.get(id);
  const operation=(async()=>{
   mark('weather_cache_started');const record=await this.read(place,provider),base=collectionBase(now);mark('weather_cache_finished',{cached:!!record});
   if(record&&stamp(record.base)>=stamp(base))return {status:'saved',base:record.base};
   if(retry)this.failures.delete(id);
   const failure=this.failures.get(id);
   if(failure&&stamp(failure.base)===stamp(base)&&(failure.attempts>=3||now.getTime()-failure.at<RETRY_DELAY_MS))return {status:'retry-wait',error:failure.code};
   try{
    mark('weather_provider_started');const collected=await this.collector(place,{provider,now});mark('weather_provider_finished',{count:collected.items?.length});
    mark('weather_save_started');const persisted=await this.save(collected,place,provider,record);mark('weather_save_finished');this.failures.delete(id);
    return {status:'updated',base:persisted.base,changes:persisted.changes};
   }catch(error){
    mark('weather_operation_failed',safeError(error));const code=['KEY_REQUIRED','KMA_KEY','KMA_CONNECTION','KMA_RESPONSE','NO_FORECAST'].includes(error.message)?error.message:'KMA_CONNECTION';
    this.failures.set(id,{base,at:now.getTime(),code,attempts:failure&&stamp(failure.base)===stamp(base)?failure.attempts+1:1});
    throw new Error(code);
   }
  })();
  this.pending.set(id,operation);try{return await operation;}finally{this.pending.delete(id);}
 }
}
