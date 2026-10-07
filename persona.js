import {regionIds,temperaturePreferences} from './user-settings.js';
import {moodPreferences} from './style-taxonomy.js';
import {todayKey} from './engine.js';

export const blankProfile=()=>({routine:'',days:[],dressCode:null,walking:null,cooling:null,heating:null,exposure:null,sensitive:'',fit:'',style:'',moodPreferences:[],bodyNote:''});
export const fresh=()=>({closet:[],profile:blankProfile(),schedule:{date:todayKey(),text:''},weather:null,history:[],confirmedGroups:[],answers:[],feedback:[],onboarding:{version:1,completedAt:null,step:0,draft:null}});
export function demoState(){
 const state=fresh();
 state.profile={...blankProfile(),routine:'출근',days:[1,2,3,4,5],dressCode:1,walking:30,cooling:true,exposure:'indoor',fit:'여유 있는 핏',style:'미니멀'};
 state.answers=['exposure','cooling','walking','fit','style'].map(key=>({key,value:state.profile[key],date:'예시 생활',source:'예시'}));
 state.schedule={date:todayKey(),text:'출근 후 저녁 약속'};
 state.weather={date:todayKey(),min:18,max:24,rain:70,snow:false,source:'예시 날씨',place:'서울 · 예시',hourly:[8,9,12,15,18,19,20,21].map(hour=>({hour,temp:hour<10?18:hour>17?20:24,rain:hour>17?70:10,pty:hour>17?1:0,wind:2}))};
 const specs=[
 ['흰색 셔츠','top','흰색',1,1,'미니멀','여유 있는 핏'],
 ['회색 티셔츠','top','회색',0,0,'캐주얼','여유 있는 핏'],
 ['남색 니트','top','남색',2,1,'클래식','기본 핏'],
 ['베이지 블라우스','top','베이지',0,1,'미니멀','여유 있는 핏'],
 ['초록 맨투맨','top','초록',1,0,'캐주얼','여유 있는 핏'],
 ['검정 슬랙스','bottom','검정',1,1,'미니멀','여유 있는 핏'],
 ['베이지 치노','bottom','베이지',1,1,'캐주얼','여유 있는 핏'],
 ['남색 데님','bottom','남색',1,0,'캐주얼','기본 핏'],
 ['흰색 스니커즈','shoe','흰색',0,0,'캐주얼','기본 핏'],
 ['검정 로퍼','shoe','검정',0,1,'클래식','기본 핏'],
 ['베이지 가디건','outer','베이지',1,1,'미니멀','여유 있는 핏'],
 ['검정 재킷','outer','검정',2,2,'클래식','여유 있는 핏']
 ];
 state.closet=specs.map((v,i)=>({id:'mvp-demo-'+i,name:v[0],category:v[1],color:v[2],warmth:v[3],formal:v[4],style:v[5],fit:v[6],comfort:i!==9,available:true,photo:null,capture:null,officialColor:'',url:''}));
 return state;
}
export function normalizeState(data){const base=fresh();return {...base,...data,locationIds:regionIds(data||{}),profile:{...base.profile,...data?.profile,moodPreferences:moodPreferences(data?.profile||{}),sensitivities:temperaturePreferences(data?.profile||{})},onboarding:{...base.onboarding,...data?.onboarding},answers:data?.answers||[],feedback:data?.feedback||[]};}
