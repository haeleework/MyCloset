import test from 'node:test';
import assert from 'node:assert/strict';
import {regionIds,selectedWeather,temperaturePreferences} from './user-settings.js';
import {normalizeState,fresh} from './persona.js';
import {setupResult} from './onboarding.js';
import {contexts} from './engine.js';
import {weatherPlan} from './conditions.js';
const date='2026-10-07',now=Date.parse('2026-10-07T10:00:00+09:00');
const record=(id,temp,rain=0)=>({date,placeId:id,source:'기상청 단기예보',min:temp,max:temp,rain,snow:false,fetchedAt:new Date(now).toISOString(),hourly:[10,12,15,18].map(hour=>({hour,temp,rain,pty:rain>=40?1:0}))});
const state=forecasts=>({locationIds:['seoul','incheon'],weather:{...forecasts[0],forecasts}});
const context=()=>contexts(fresh().profile,'',date);
test('legacy single city and sensitivity migrate; explicit empty arrays clear them',()=>{
 const old=normalizeState({locationId:'seoul',profile:{sensitive:'추위를 많이 타요'}});
 assert.deepEqual(regionIds(old),['seoul']);assert.deepEqual(temperaturePreferences(old.profile),['추위를 많이 타요']);
 assert.deepEqual(regionIds({locationId:'seoul',locationIds:[]}),[]);
 assert.deepEqual(temperaturePreferences({sensitive:'추위를 많이 타요',sensitivities:[]}),[]);
});
test('first setup saves multiple cities and both sensitivities without overwriting either',()=>{
 const result=setupResult({locationIds:['seoul','incheon','seoul','invalid'],sensitivities:['추위를 많이 타요','더위를 많이 타요']});
 assert.deepEqual(result.locationIds,['seoul','incheon']);assert.deepEqual(result.profile.sensitivities,['추위를 많이 타요','더위를 많이 타요']);
 assert.equal(result.locationId,'seoul');assert.deepEqual(temperaturePreferences({sensitivities:['보통','더위를 많이 타요']}),['더위를 많이 타요']);
});
test('a second selected city changes rain and cold advice rather than just the displayed labels',()=>{
 const combined=selectedWeather(state([record('seoul',24),record('incheon',8,80)]),date,now);
 const plan=weatherPlan(combined,context());assert.equal(plan.low,8);assert.equal(plan.high,24);assert.equal(plan.umbrella,true);assert.equal(plan.outerTarget,2);
 const single=selectedWeather({...state(combined.forecasts),locationIds:['seoul']},date,now);
 assert.equal(weatherPlan(single,context()).umbrella,false);assert.equal(weatherPlan(single,context()).outerNeeded,false);
});
test('expired or missing city is disclosed, while unrelated cached cities are excluded',()=>{
 const seoul=record('seoul',24),expired={...record('incheon',3,80),fetchedAt:new Date(now-7*3600000).toISOString()};
 const combined=selectedWeather(state([seoul,expired,record('busan',-3,90)]),date,now);
 assert.equal(combined.partial,true);assert.deepEqual(combined.missingPlaces,['인천']);assert.equal(combined.min,24);assert.equal(combined.rain,0);
 assert.equal(selectedWeather({locationIds:['incheon'],weather:{...seoul,forecasts:[seoul]}},date,now),null);
});
test('city without activity-hour observations uses its temperature and precipitation fallback',()=>{
 const combined=selectedWeather(state([record('seoul',24),{...record('incheon',8,80),hourly:[]}]),date,now);
 const plan=weatherPlan(combined,context());assert.equal(plan.low,8);assert.equal(plan.umbrella,true);
});
test('cold and heat sensitivity coexist as removable outerwear and cooler warm-day base clothing',()=>{
 const ctx=contexts({...fresh().profile,sensitivities:['추위를 많이 타요','더위를 많이 타요']},'',date);
 const plan=weatherPlan({min:23,max:25,rain:0},ctx);assert.equal(plan.outerNeeded,true);assert.equal(plan.baseTarget,0);
 assert.ok(plan.actions.some(a=>a.includes('벗고 입기')));
 const cold=weatherPlan({min:1,max:8,rain:0},ctx);assert.equal(cold.baseTarget,2);assert.equal(cold.outerTarget,2);
});
