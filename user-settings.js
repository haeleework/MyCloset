import {placeById} from './region-data.js';
// Legacy raw choices retained for old records. New user mood UI uses style-taxonomy.js.
export const styleOptions=[
 ['미니멀','간결한 색과 장식'],['캐주얼','편안한 일상 복장'],['클래식','단정하고 차분한 분위기'],
 ['스포티','활동적인 운동복 분위기'],['스트리트','넉넉한 실루엣과 눈에 띄는 포인트'],['빈티지','옛 옷의 분위기와 색감'],
 ['내추럴','자연스러운 색과 편안한 분위기'],['로맨틱','레이스·프릴 등 부드러운 장식'],['시크','절제된 색과 선명한 실루엣']
];
export function stylePreferences(profile){
 const values=Array.isArray(profile.styles)?profile.styles:[profile.style].filter(Boolean);
 return [...new Set(values.filter(value=>styleOptions.some(([name])=>name===value)))];
}
export const cityOptions=[['seoul','서울'],['busan','부산'],['daegu','대구'],['incheon','인천'],['daejeon','대전'],['gwangju','광주'],['jeju','제주'],['suwon','수원']];
export const cityName=id=>placeById.get(id)?.name||cityOptions.find(([key])=>key===id)?.[1]||id;
const unique=values=>[...new Set(values)];
export function regionIds(state){
 const values=Array.isArray(state.locationIds)?state.locationIds:[state.locationId].filter(Boolean);
 return unique(values.filter(id=>placeById.has(id)||cityOptions.some(([key])=>key===id)));
}
export function temperaturePreferences(profile){
 const values=Array.isArray(profile.sensitivities)?profile.sensitivities:[profile.sensitive].filter(Boolean);
 const chosen=unique(values.filter(v=>['보통','추위를 많이 타요','더위를 많이 타요'].includes(v)));
 return chosen.some(v=>v!=='보통')?chosen.filter(v=>v!=='보통'):chosen;
}
// Use every selected city's saved forecast; never invent a commute route or visit times.
export function selectedWeather(state,date,now=Date.now()){
 const weather=state.weather;
 if(!weather||weather.date!==date||String(weather.source).includes('Open-Meteo'))return null;
 const fresh=f=>!f.fetchedAt||Number.isFinite(Date.parse(f.fetchedAt))&&now-Date.parse(f.fetchedAt)<=6*3600000;
 if(weather.source!=='기상청 단기예보')return fresh(weather)?weather:null;
 const ids=regionIds(state);if(!ids.length)return null;
 const available=(weather.forecasts||[weather]).filter(f=>ids.includes(f.placeId)&&f.date===date&&fresh(f)&&Number.isFinite(f.min)&&Number.isFinite(f.max));
 const forecasts=ids.flatMap(id=>{const item=available.find(f=>f.placeId===id);return item?[item]:[];});
 if(!forecasts.length)return null;
 const missing=ids.filter(id=>!forecasts.some(f=>f.placeId===id));
 const rain=forecasts.map(f=>f.rain).filter(Number.isFinite);
 return {...forecasts[0],source:'기상청 단기예보',forecasts,requestedPlaceIds:ids,
  min:Math.min(...forecasts.map(f=>f.min)),max:Math.max(...forecasts.map(f=>f.max)),
  rain:rain.length?Math.max(...rain):null,
  snow:forecasts.some(f=>f.snow===true)?true:forecasts.every(f=>f.snow===false)?false:null,
  hourly:forecasts.flatMap(f=>(f.hourly||[]).map(h=>({...h,place:cityName(f.placeId)}))),
  place:forecasts.map(f=>cityName(f.placeId)).join(' · '),missingPlaces:missing.map(cityName),partial:missing.length>0,
  stale:forecasts.some(f=>f.stale),nextUpdateAt:weather.nextUpdateAt,
  rangeKind:forecasts.length>1?'multiple-regions':forecasts[0].rangeKind};
}
