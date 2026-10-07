import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validDate,holidayRefreshMs,holidaySourceUrl} from './holidays.js';
export const holidayEndpoint='https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const failure=(code)=>Object.assign(new Error(code),{code});
const validYear=year=>Number.isInteger(year)&&year>=2000&&year<=2100;
export function parseHolidayResponse(input,year,now=new Date()){
 if(!validYear(year))throw failure('HOLIDAY_YEAR');
 const response=input?.response,body=response?.body;
 if(['20','30','31'].includes(String(response?.header?.resultCode)))throw failure('HOLIDAY_AUTH');
 if(!['00','0'].includes(String(response?.header?.resultCode)))throw failure('HOLIDAY_RESPONSE');
 const total=Number(body?.totalCount);let items=body?.items?.item;
 if(!Number.isInteger(total)||total<0||total>1000)throw failure('HOLIDAY_RESPONSE');
 items=items==null?[]:Array.isArray(items)?items:[items];
 if(items.length!==total||total===0)throw failure('HOLIDAY_INCOMPLETE');
 const holidays=[];
 for(const item of items){
  if(!['Y','N'].includes(item.isHoliday))throw failure('HOLIDAY_RESPONSE');
  const raw=String(item.locdate),date=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8);
  if(!/^\d{8}$/.test(raw)||!validDate(date)||Number(raw.slice(0,4))!==year||typeof item.dateName!=='string'||!item.dateName.trim())throw failure('HOLIDAY_RESPONSE');
  if(item.isHoliday==='Y')holidays.push({date,name:item.dateName.trim().slice(0,100)});
 }
 if(!holidays.length)throw failure('HOLIDAY_INCOMPLETE');
 const unique=[...new Map(holidays.map(h=>[h.date+'|'+h.name,h])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 return {year,complete:true,holidays:unique,fetchedAt:now.toISOString(),source:'한국천문연구원 특일 정보 API',sourceUrl:holidaySourceUrl};
}
export async function collectHolidayYear(year,key,{fetchImpl=fetch,now=new Date()}={}){
 if(!key)throw failure('HOLIDAY_KEY_REQUIRED');
 if(!validYear(year))throw failure('HOLIDAY_YEAR');
 const url=new URL(holidayEndpoint);let decodedKey=key;
 try{if(key.includes('%'))decodedKey=decodeURIComponent(key);}catch{throw failure('HOLIDAY_AUTH');}
 url.search=new URLSearchParams({ServiceKey:decodedKey,solYear:String(year),numOfRows:'1000',pageNo:'1',_type:'json'}).toString();
 let r,text;
 try{r=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'error'});text=await r.text();}catch{throw failure('HOLIDAY_CONNECTION');}
 if([401,403].includes(r.status)||/SERVICE_(?:ACCESS_DENIED|KEY_IS_NOT_REGISTERED)|PERMISSION_DENIED/.test(text))throw failure('HOLIDAY_AUTH');
 if(!r.ok)throw failure('HOLIDAY_CONNECTION');
 let data;try{data=JSON.parse(text);}catch{throw failure('HOLIDAY_RESPONSE');}
 return parseHolidayResponse(data,year,now);
}
export class HolidayStore{
 constructor(directory,{collect=collectHolidayYear,now=()=>new Date(),journal=null,seedFile=null}={}){
  this.directory=directory;this.collect=collect;this.now=now;this.journal=journal;this.seedFile=seedFile;this.years={};this.failures={};this.attempts=new Map();this.running=null;this.ready=this.load();
 }
 async load(){
  const currentYear=Number(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric'}).format(this.now()));
  if(this.seedFile){try{const seed=JSON.parse(await readFile(this.seedFile,'utf8'));for(const [year,record]of Object.entries(seed.years||{}))if(this.validRecord(record,Number(year)))this.years[year]=record;}catch{this.journal?.event('holiday_seed_unavailable');}}
  for(const year of [currentYear,currentYear+1]){
   try{const record=JSON.parse(await readFile(path.join(this.directory,year+'.json'),'utf8'));if(!this.validRecord(record,year))throw failure('HOLIDAY_RESPONSE');this.years[year]=record;}catch(e){if(e.code!=='ENOENT')this.journal?.event('holiday_cache_unavailable',{errorCode:'HOLIDAY_RESPONSE'});}
  }
 }
 validRecord(record,year){return validYear(year)&&record?.year===year&&typeof record.complete==='boolean'&&Number.isFinite(Date.parse(record.fetchedAt))&&Array.isArray(record.holidays)&&record.holidays.length>0&&record.holidays.every(h=>validDate(h.date)&&Number(h.date.slice(0,4))===year&&typeof h.name==='string'&&h.name.length>0);}
 async snapshot(){await this.ready;return {version:1,refreshing:!!this.running,years:structuredClone(this.years),failures:{...this.failures},nextCheckAt:this.nextCheckAt||null};}
 async refresh(getKey,{retry=false}={}){
  if(this.running)return this.running;
  this.running=(async()=>{
   await this.ready;let key;try{key=await getKey();}catch{key='';}
   const now=this.now(),currentYear=Number(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric'}).format(now));
   for(const year of [currentYear,currentYear+1]){
    const saved=this.years[year],age=now-Date.parse(saved?.fetchedAt||'');
    if(!retry&&saved?.complete&&age>=0&&age<holidayRefreshMs)continue;
    if(!retry&&now.getTime()-(this.attempts.get(year)||0)<60*60*1000)continue;
    if(!key){this.failures[year]='HOLIDAY_KEY_REQUIRED';continue;}
    this.attempts.set(year,now.getTime());this.journal?.event('holiday_collection_started');
    try{
     const record=await this.collect(year,key,{now});if(!this.validRecord(record,year)||!record.complete)throw failure('HOLIDAY_RESPONSE');
     await mkdir(this.directory,{recursive:true});const temp=path.join(this.directory,year+'.'+randomUUID()+'.tmp');
     await writeFile(temp,JSON.stringify(record),{flag:'wx'});await rename(temp,path.join(this.directory,year+'.json'));
     this.years[year]=record;delete this.failures[year];this.journal?.event('holiday_collection_finished',{count:record.holidays.length,saved:true});
    }catch(e){this.failures[year]=['HOLIDAY_AUTH','HOLIDAY_CONNECTION','HOLIDAY_RESPONSE','HOLIDAY_INCOMPLETE'].includes(e.code)?e.code:'HOLIDAY_SAVE_FAILED';this.journal?.event('holiday_collection_failed',{errorCode:this.failures[year]});}
   }
   this.nextCheckAt=new Date(now.getTime()+60*60*1000).toISOString();
  })().finally(()=>{this.running=null;});return this.running;
 }
 start(getKey){this.refresh(getKey).catch(()=>{});this.timer=setInterval(()=>this.refresh(getKey).catch(()=>{}),60*60*1000);this.timer.unref();}
 stop(){clearInterval(this.timer);}
}
