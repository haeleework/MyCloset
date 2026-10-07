// No network or inferred answers: this module handles only explicit first-use settings.
import {regionIds,temperaturePreferences,stylePreferences} from './user-settings.js';
import {moodPreferences} from './style-taxonomy.js';
export const setupVersion=4;
export const needsSetup=(state,mode='real')=>mode==='real'&&!(state.closet||[]).length&&!state.onboarding?.completedAt;
const number=v=>v===''||v==null?null:Number(v);
const boolean=v=>v==='true'?true:v==='false'?false:null;
export function setupResult(input,existing={},timestamp=new Date().toISOString()){
 const days=[...new Set((input.days||[]).map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))];
 const legacyInput=Object.hasOwn(input,'styles')||Object.hasOwn(input,'style');
 const styles=legacyInput?stylePreferences(input):existing.styles||stylePreferences(existing);
 const moods=Object.hasOwn(input,'moodPreferences')||Object.hasOwn(existing,'moodPreferences')||!legacyInput?{moodPreferences:moodPreferences(input)}:{};
 return {profile:{...existing,routine:input.routine||'',days:input.routine?days:[],dressCode:number(input.dressCode),walking:number(input.walking),exposure:input.exposure||null,cooling:boolean(input.cooling),heating:boolean(input.heating),sensitivities:temperaturePreferences(input),sensitive:temperaturePreferences(input)[0]||'',fit:input.fit||'',styles,style:legacyInput?styles[0]||'':existing.style||'',...moods,bodyNote:input.bodyNote==null?(existing.bodyNote||''):(input.bodyNote||'').trim()},locationIds:regionIds(input),locationId:regionIds(input)[0]||null,onboarding:{version:setupVersion,completedAt:timestamp,step:0,draft:null}};
}
