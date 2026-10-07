import {districtPlaces,townPlaces} from './region-data.js';
// City-centre grid points. The UI explicitly labels these as representative locations.
export const legacyPlaces=[{id:'seoul',name:'서울 · 종로 대표지점',nx:60,ny:127},{id:'busan',name:'부산 · 연제 대표지점',nx:98,ny:76},{id:'daegu',name:'대구 · 중구 대표지점',nx:89,ny:90},{id:'incheon',name:'인천 · 남동 대표지점',nx:55,ny:124},{id:'daejeon',name:'대전 · 서구 대표지점',nx:67,ny:100},{id:'gwangju',name:'광주 · 서구 대표지점',nx:58,ny:74},{id:'jeju',name:'제주 · 제주시 대표지점',nx:52,ny:38},{id:'suwon',name:'수원 · 경기 대표지점',nx:60,ny:121}];
export const places=[...legacyPlaces,...districtPlaces,...townPlaces];

export function baseTime(now=new Date()){
 // The 2026-09-28 guide says API data is available after +10 minutes.
 // Wait five additional minutes before requesting that publication.
 const local=new Date(now.getTime()+9*3600000-15*60000);
 let h=local.getUTCHours();const hours=[2,5,8,11,14,17,20,23];
 let selected=hours.filter(v=>v<=h).at(-1);
 if(selected===undefined){local.setUTCDate(local.getUTCDate()-1);selected=23;}
 return {base_date:local.toISOString().slice(0,10).replaceAll('-',''),base_time:String(selected).padStart(2,'0')+'00'};
}
export function collectionBase(now=new Date()){
 return baseTime(now);
}
export function nextCollectionTime(now=new Date()){
 const base=collectionBase(now),d=base.base_date;
 return new Date(new Date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)+'T'+base.base_time.slice(0,2)+':15:00+09:00').getTime()+3*3600000).toISOString();
}
export function normalizeForecast(items,date){
 const map=new Map(),daily={};
 for(const i of items){
  if(i.fcstDate!==date.replaceAll('-','')||String(i.fcstValue).trim()==='')continue;
  const value=Number(i.fcstValue);if(!Number.isFinite(value))continue;
  if(i.category==='TMN')daily.min=value;if(i.category==='TMX')daily.max=value;
  const h=Number(i.fcstTime.slice(0,2));if(!Number.isInteger(h)||h<0||h>23)continue;
  if(!map.has(h))map.set(h,{hour:h});const row=map.get(h);const field={TMP:'temp',POP:'rain',PTY:'pty',WSD:'wind',REH:'humidity'}[i.category];if(field&&(field!=='humidity'||value>=0&&value<=100))row[field]=value;
 }
 const hourly=[...map.values()].filter(h=>Number.isFinite(h.temp)).sort((a,b)=>a.hour-b.hour);
 if(!hourly.length)throw new Error('NO_FORECAST');
 const temperatures=hourly.map(h=>h.temp);
 const rain=hourly.map(h=>h.rain).filter(Number.isFinite);
 const dailyRange=Number.isFinite(daily.min)&&Number.isFinite(daily.max);
 return {date,min:dailyRange?daily.min:Math.min(...temperatures),max:dailyRange?daily.max:Math.max(...temperatures),rangeKind:dailyRange?'daily':'forecast-hours',fromHour:hourly[0].hour,throughHour:hourly.at(-1).hour,rain:rain.length?Math.max(...rain):null,snow:hourly.some(h=>Number.isFinite(h.pty))?hourly.some(h=>[2,3].includes(h.pty)):null,hourly,source:'기상청 단기예보',fetchedAt:new Date().toISOString()};
}
export async function collectForecast(place,key,{now=new Date(),fetcher=fetch,provider='data'}={}){
 if(!key)throw new Error('KEY_REQUIRED');
 const base=baseTime(now),items=[];
 // Decoding once accepts the portal's encoded key without double encoding it.
 let decoded=key;try{decoded=decodeURIComponent(key);}catch{}
 for(let page=1;page<=5;page++){
  const query=new URLSearchParams({...base,[provider==='hub'?'authKey':'serviceKey']:decoded,pageNo:String(page),numOfRows:'1000',dataType:'JSON',nx:String(place.nx),ny:String(place.ny)});
  const endpoint=provider==='hub'?'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst':'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
  let response;try{response=await fetcher(endpoint+'?'+query,{signal:AbortSignal.timeout(12000)});}catch{throw new Error('KMA_CONNECTION');}
  if(!response.ok)throw new Error('KMA_CONNECTION');
  let data;try{data=await response.json();}catch{throw new Error('KMA_RESPONSE');}
  const header=data.response?.header;
  if(header?.resultCode!=='00')throw new Error(['20','30','31'].includes(header?.resultCode)?'KMA_KEY':'KMA_RESPONSE');
  const body=data.response.body,list=body.items?.item;
  if(!Array.isArray(list))throw new Error('NO_FORECAST');
  items.push(...list);
  if(items.length>=Number(body.totalCount)||list.length<1000)break;
 }
 return {provider,placeId:place.id,base,items,fetchedAt:now.toISOString()};
}
export async function getForecast(place,key,options={}){
 const record=await collectForecast(place,key,options);
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(options.now||new Date());
 return {...normalizeForecast(record.items,date),place:place.name,placeId:place.id,base:record.base,fetchedAt:record.fetchedAt};
}
