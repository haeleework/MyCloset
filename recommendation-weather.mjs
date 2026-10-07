import {places} from './weather.mjs';
import {finiteValue} from './recommendation-attributes.js';
const humidityValue=v=>{const n=finiteValue(v);return n!==null&&n>=0&&n<=100?n:null;};
export function normalizeRecommendationWeather(value){
 if(!value)return null;
 const hourly=(value.hourly||value.hours||[]).map(h=>({...h,hour:finiteValue(h.hour),temp:finiteValue(h.temp??h.temperature),humidity:humidityValue(h.humidity??h.reh)}));
 return {...value,min:finiteValue(value.min??value.temperatureMin),max:finiteValue(value.max??value.temperatureMax),humidity:humidityValue(value.humidity),hourly};
}
export function weatherSummary(value){
 const w=normalizeRecommendationWeather(value),humidities=(w?.hourly||[]).map(h=>h.humidity).filter(Number.isFinite);
 const base=w?.base,issuedAt=w?.issuedAt||(base?.base_date&&base?.base_time?`${base.base_date.slice(0,4)}-${base.base_date.slice(4,6)}-${base.base_date.slice(6,8)}T${base.base_time.slice(0,2)}:${base.base_time.slice(2,4)}:00+09:00`:null);
 return {kind:w?.kind==='observation'?'observation':'forecast',temperatureMin:w?.min??null,temperatureMax:w?.max??null,humidity:w?.humidity??(humidities.length?Math.round(humidities.reduce((a,b)=>a+b,0)/humidities.length):null),issuedAt,fetchedAt:w?.fetchedAt??null,cached:w?.cacheSource==='saved'||w?.cached===true,stale:w?.stale??null};
}
function requestedPlaces(profile,context){
 const ids=[...(profile.locationIds||[]),...(profile.cities||[]),profile.locationId,profile.city,...(context.locationIds||[]),...(context.placeIds||[]),context.locationId,context.placeId].filter(v=>typeof v==='string');
 const names=(context.events||[]).map(e=>e.location).filter(v=>typeof v==='string');
 const selected=places.filter(p=>ids.includes(p.id)||ids.includes(p.name));
 for(const name of names){const exact=places.find(p=>p.name===name||p.id===name);const legacy=places.find(p=>!p.id.includes('-')&&name.includes(p.name.split(' · ')[0]));if(exact||legacy)selected.push(exact||legacy);}
 return [...new Map(selected.map(p=>[p.id,p])).values()];
}
/** Reads only ForecastStore.saved: never refreshes, subscribes or calls a collector. */
export function createSavedWeatherProvider({store,settings=()=>({provider:'data'}),readConfig=async()=>{},now=()=>new Date()}={}){
 return async({profile={},context={}}={})=>{
  const start=performance.now();await readConfig();const config=settings(),selected=requestedPlaces(profile,context),warnings=[];
  const results=await Promise.allSettled(selected.map(place=>store.saved(place,config.provider||'data',{now:now()})));
  const forecasts=results.flatMap(r=>r.status==='fulfilled'?[normalizeRecommendationWeather(r.value)]:[]).filter(w=>Number.isFinite(w.min)&&Number.isFinite(w.max));
  const missing=selected.filter((p,i)=>results[i].status==='rejected'||!forecasts.some(f=>f.placeId===p.id));
  if(!selected.length)warnings.push('활동 지역이 없어 저장된 예보를 선택하지 못했어요.');
  if(missing.length)warnings.push(missing.map(p=>p.name).join(' · ')+': 사용할 수 있는 저장 예보가 없어요.');
  const rain=forecasts.map(f=>f.rain).filter(Number.isFinite),humidity=forecasts.flatMap(f=>f.hourly?.map(h=>h.humidity)||[f.humidity]).filter(Number.isFinite);
  const weather=forecasts.length?{...forecasts[0],kind:'forecast',forecasts,min:Math.min(...forecasts.map(f=>f.min)),max:Math.max(...forecasts.map(f=>f.max)),hourly:forecasts.flatMap(f=>f.hourly.map(h=>({...h,place:f.place}))),humidity:humidity.length?Math.round(humidity.reduce((a,b)=>a+b,0)/humidity.length):forecasts[0].humidity,rain:rain.length?Math.max(...rain):null,partial:missing.length>0,missingPlaces:missing.map(p=>p.name),stale:forecasts.some(f=>f.stale),cacheSource:'saved',place:forecasts.map(f=>f.place).join(' · ')}:null;
  return {weather,summary:weatherSummary(weather),providerCalled:false,timingsMs:{weatherCacheRead:Math.round((performance.now()-start)*100)/100,weatherProvider:null},warnings};
 };
}
// Official reference: https://www.data.go.kr/data/15084084/openapi.do
// getUltraSrtNcst is observed AWS data, distinct from getVilageFcst forecasts.
export function normalizeObservation(items,{fetchedAt=null}={}){
 const latest=items.filter(i=>i&&i.baseDate&&i.baseTime).map(i=>String(i.baseDate)+String(i.baseTime)).sort().at(-1);
 const rows=items.filter(i=>String(i.baseDate)+String(i.baseTime)===latest),values=Object.fromEntries(rows.map(i=>[i.category,finiteValue(i.obsrValue)]));
 if(values.T1H==null)throw new Error('NO_OBSERVATION');
 const d=latest.slice(0,8),t=latest.slice(8),issuedAt=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:00+09:00`;
 return {kind:'observation',temperature:values.T1H,temperatureMin:values.T1H,temperatureMax:values.T1H,humidity:humidityValue(values.REH),issuedAt,fetchedAt,cached:false,stale:false,source:'기상청 초단기실황'};
}
/** Explicit opt-in observation adapter. Caller injects data retrieval; forecasts are never relabeled. */
export function createObservationProvider({fetchObservation,now=()=>new Date()}={}){
 return async args=>{
  if(typeof fetchObservation!=='function')throw new Error('OBSERVATION_PROVIDER_REQUIRED');const start=performance.now(),value=await fetchObservation(args);
  let observation;
  if(value?.kind==='observation'&&Number.isFinite(value.temperature)&&Number.isFinite(Date.parse(value.issuedAt))){observation={...value,temperatureMin:value.temperature,temperatureMax:value.temperature,humidity:humidityValue(value.humidity),fetchedAt:value.fetchedAt||now().toISOString()};}
  else if(Array.isArray(value?.items||value))observation=normalizeObservation(value.items||value,{fetchedAt:value.fetchedAt||now().toISOString()});
  else throw new Error('NO_OBSERVATION');
  return {observation,timingsMs:{weatherProvider:Math.round((performance.now()-start)*100)/100}};
 };
}
export async function collectObservation(place,key,{fetchImpl=fetch,now=new Date(),provider='data'}={}){
 if(!key)throw new Error('KEY_REQUIRED');
 if(!place||!Number.isFinite(place.nx)||!Number.isFinite(place.ny))throw new Error('INVALID_PLACE');
 // KMA hourly observations: conservatively request the preceding available hour.
 const local=new Date(now.getTime()+9*3600000-45*60000),base_date=local.toISOString().slice(0,10).replaceAll('-',''),base_time=String(local.getUTCHours()).padStart(2,'0')+'00';
 let decoded=key;try{decoded=decodeURIComponent(key);}catch{}
 const query=new URLSearchParams({[provider==='hub'?'authKey':'serviceKey']:decoded,pageNo:'1',numOfRows:'1000',dataType:'JSON',base_date,base_time,nx:String(place.nx),ny:String(place.ny)});
 const endpoint=provider==='hub'?'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst':'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
 let response;try{response=await fetchImpl(endpoint+'?'+query,{signal:AbortSignal.timeout(12000)});}catch{throw new Error('KMA_CONNECTION');}
 if(!response.ok)throw new Error('KMA_CONNECTION');
 let data;try{data=await response.json();}catch{throw new Error('KMA_RESPONSE');}
 const header=data.response?.header;if(header?.resultCode!=='00')throw new Error(['20','30','31'].includes(header?.resultCode)?'KMA_KEY':'KMA_RESPONSE');
 const items=data.response?.body?.items?.item;if(!Array.isArray(items))throw new Error('NO_OBSERVATION');
 return {...normalizeObservation(items,{fetchedAt:now.toISOString()}),placeId:place.id,place:place.name};
}
