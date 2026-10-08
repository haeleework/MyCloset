import {ForecastStore,compareForecasts} from './forecast-store.mjs';
import {places} from './weather.mjs';
import {collectHolidayYear} from './holiday-store.mjs';
import {holidayRefreshMs} from './holidays.js';

// Disposable public weather cache only; never use this for garments or AI budgets.
export class VercelForecastStore extends ForecastStore {
 constructor(cache,collector){super('/tmp/mycloset-weather',collector);this.cache=cache;}
 cacheKey(place,provider){this.file(place,provider);return `forecast:${provider}:${place.id}`;}
 async read(place,provider){const record=await this.cache.get(this.cacheKey(place,provider));return record?.placeId===place.id&&record.provider===provider&&Array.isArray(record.items)&&Number.isFinite(Date.parse(record.fetchedAt))?record:null;}
 async save(record,place,provider,previous){
  const safe={provider,placeId:place.id,base:record.base,items:record.items,fetchedAt:record.fetchedAt,changes:compareForecasts(previous?.items,record.items)};
  if(previous)safe.previous={provider,placeId:place.id,base:previous.base,items:previous.items,fetchedAt:previous.fetchedAt};
  await this.cache.set(this.cacheKey(place,provider),safe,{ttl:21600});return safe;
 }
 async subscribe(ids){if(!Array.isArray(ids)||ids.some(id=>!places.some(p=>p.id===id)))throw Error('INVALID_PLACE');}
 async prepare(selected,provider){await Promise.allSettled(selected.map(place=>this.refresh(place,provider)));}
}

export function createCachedHolidays({cache,seed,getKey,collect=collectHolidayYear,now=()=>new Date()}){
 return {async snapshot(){
  const current=Number(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric'}).format(now()));
  const years={},failures={};
  await Promise.all([current,current+1].map(async year=>{
   const id=`holiday:${year}`;let record;
   try{record=await cache.get(id);}catch{}
   if(record)years[year]=record;else if(seed.years?.[year])years[year]=seed.years[year];
   if(record&&now()-Date.parse(record.fetchedAt)<holidayRefreshMs)return;
   try{const key=getKey();if(!key)throw Error('HOLIDAY_KEY_REQUIRED');record=await collect(year,key,{now:now()});await cache.set(id,record,{ttl:Math.ceil(holidayRefreshMs/1000)});years[year]=record;}
   catch{failures[year]='HOLIDAY_UNAVAILABLE';}
  }));
  return {version:1,refreshing:false,years,failures,nextCheckAt:new Date(now().getTime()+holidayRefreshMs).toISOString()};
 }};
}
