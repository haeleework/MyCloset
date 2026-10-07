import {todayKey} from './engine.js';
export function warmthBias(feedback,weather,date=todayKey()){
 if(!weather)return 0;
 const current=weather.max>=24?'warm':weather.max<=12?'cold':'mild';
 const recent=(feedback||[]).filter(f=>f.wore&&f.season===current&&f.date<=date&&Date.parse(date)-Date.parse(f.date)<30*86400000).slice(-3);
 if(recent.length<2)return 0;
 const cold=recent.filter(f=>f.feeling==='cold').length,hot=recent.filter(f=>f.feeling==='hot').length;
 return cold>=2&&hot===0?1:hot>=2&&cold===0?-1:0;
}
export function feedbackSeason(weather){return !weather?'unknown':weather.max>=24?'warm':weather.max<=12?'cold':'mild';}
