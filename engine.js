import {temperaturePreferences,cityName,stylePreferences} from './user-settings.js';
import {moodPreferences,moodLabels,itemMoodMatch} from './style-taxonomy.js';
import {weatherPlan} from './conditions.js';
import {comfortCandidates,comfortResult,garmentKindHint} from './outfit-comfort.js';
import {dressPolicy,assessDressItem,officePolicyReason} from './dress-policy.js';
import {assessTemperature} from './recommendation-attributes.js';
import {scoreColor} from './recommendation-color.js';
export {comfortAdjustmentMessage,comfortTag} from './outfit-comfort.js';
export function todayKey(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());}
export function contexts(profile,text,date=todayKey(),events=[],holiday=null){
 const weekday=new Date(date+'T12:00:00+09:00').getUTCDay();
 const manualRest=/휴가|쉬는 날|출근 안|등교 안/.test(text);
 const explicitWork=!manualRest&&/(?:출근|등교)(?:해요|합니다|할 예정|해야|하는 날| 예정| 후|$)|공휴일(?:에도|에)?\s*(?:출근|등교|근무)|오늘\s*(?:출근|등교)|근무일|휴일 근무/.test(text);
 const explicitRoutine=explicitWork?(/등교/.test(text)?'등교':/출근|근무/.test(text)?'출근':profile.routine):'';
 const remote=/재택/.test(text);
 const autoHoliday=holiday?.isHoliday===true&&!explicitWork&&!remote;
 const exception=manualRest||autoHoliday;
 const routine=!exception&&!remote?(explicitRoutine||(profile.days||[]).includes(weekday)&&profile.routine||''):'';
 const formal=/면접|결혼식|발표|격식|중요한 미팅/.test(text)?2:Math.max(routine?Number(profile.dressCode||0):0,/약속|식사|미팅/.test(text)?1:0);
 const regularConditions=!exception&&!remote&&(Boolean(routine)||!profile.routine);
 const walking=Math.max(regularConditions?Number(profile.walking||0):0,/많이 걷|산책|도보/.test(text)?30:0);
 return{routine,remote,exception,formal,walking,text,events,holiday,autoHoliday,holidayOverride:holiday?.isHoliday===true&&explicitWork&&!remote,cooling:regularConditions&&Boolean(profile.cooling),heating:regularConditions&&Boolean(profile.heating),exposure:regularConditions?profile.exposure||'mixed':'mixed',sensitive:profile.sensitive||'보통',sensitivities:temperaturePreferences(profile)};
}
const neutrals=new Set(['검정','흰색','회색','베이지','남색']);
export function alternativeRegistration(closet){
 const counts={top:0,bottom:0,dress:0,shoe:0,outer:0};
 for(const item of closet)if(item.available!==false&&!item.candidate&&Object.hasOwn(counts,item.category))counts[item.category]++;
 const top=Math.max(0,2-counts.top-counts.dress),bottom=Math.max(0,2-counts.bottom-counts.dress);
 const fixed=[...(!counts.shoe?[{category:'shoe',quantity:1}]:[]),...(!counts.outer?[{category:'outer',quantity:1}]:[])];
 const plans=[];
 for(let dress=0;dress<=Math.max(top,bottom);dress++){
  const needs=[...(Math.max(0,top-dress)?[{category:'top',quantity:Math.max(0,top-dress)}]:[]),...(Math.max(0,bottom-dress)?[{category:'bottom',quantity:Math.max(0,bottom-dress)}]:[]),...(dress?[{category:'dress',quantity:dress}]:[]),...fixed];
  plans.push({needs,total:needs.reduce((sum,item)=>sum+item.quantity,0)});
 }
 const minimum=Math.min(...plans.map(p=>p.total));
 return{ready:minimum===0,counts,minimum,standard:plans[0],minimumPlans:plans.filter(p=>p.total===minimum)};
}
function harmony(items){let s=0;for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)s+=items[i].color===items[j].color||neutrals.has(items[i].color)||neutrals.has(items[j].color)?1:-1;return s;}
export function recommend(closet,profile,ctx,weather,{modifier='',skip=0,history=[],requiredId=null,referenceIds=[]}={}){
 const available=closet.filter(i=>i.available!==false);
 const sets={};for(const k of ['top','bottom','dress','shoe','outer'])sets[k]=available.filter(i=>i.category===k);
 const missing=[];
 if(!sets.dress.length){if(!sets.top.length)missing.push('상의');if(!sets.bottom.length)missing.push('하의');}
 if(!sets.shoe.length)missing.push('신발');
 if(missing.length)return{missing,outfit:null};
 const plan=weatherPlan(weather,ctx);
 const known=plan.known,outerNeeded=plan.outerNeeded;
 const requiredOuter=available.find(i=>i.id===requiredId)?.category==='outer';
 const outerOptions=(outerNeeded||requiredOuter)&&sets.outer.length?sets.outer:[null];
 const bases=[...sets.dress.map(i=>[i]),...sets.top.flatMap(t=>sets.bottom.map(b=>[t,b]))];
 const office=dressPolicy(ctx).mode==='neat-casual-office';
 const formal=modifier==='formal'?Math.min(2,ctx.formal+1):office?0:ctx.formal;
 const walkingComfort=ctx.walking>=15;
 const all=[];
 const useMoods=Object.hasOwn(profile,'moodPreferences');
 for(const base of bases)for(const shoe of sets.shoe)for(const outer of outerOptions){
  const items=[...base,shoe,...(outer?[outer]:[])];
  if(requiredId&&!items.some(i=>i.id===requiredId))continue;
  let score=harmony(items);
  for(const i of items){score-=Math.max(0,formal-Number(i.formal||0))*(i.category==='shoe'?3:8);score-=Math.max(0,Number(i.formal||0)-formal);score+=i.category!=='shoe'&&profile.fit&&i.fit===profile.fit?2:0;score+=!useMoods&&stylePreferences(profile).includes(i.style)?2:0;if(walkingComfort&&i.category==='shoe')score+=i.comfort===true?7:i.comfort===false?-7:0;}
  if(known){for(const i of base)if(i.warmth!=null)score-=Math.abs(Number(i.warmth)-plan.baseTarget)*5;if(outer?.warmth!=null)score-=Math.abs(Number(outer.warmth)-plan.outerTarget)*12;}
  const recent=history.slice(-3).flatMap(h=>h.ids);score-=items.filter(i=>recent.includes(i.id)).length*.3;
  const signature=items.map(i=>i.id).join('|');all.push({items,score,signature,moodMatch:useMoods&&items.some(i=>itemMoodMatch(i,profile))});
 }
 if(!all.length)return{missing:['후보와 함께 입을 옷'],outfit:null};
 all.sort((a,b)=>b.score-a.score||Number(b.moodMatch)-Number(a.moodMatch)||a.signature.localeCompare(b.signature));
 const comparison=modifier==='comfort'?comfortCandidates(all,referenceIds,ctx,plan,profile):null;
 const candidates=(comparison?.ranked||all).filter(c=>!c.items.some(i=>assessDressItem(i,ctx).excluded)&&!assessTemperature(c.items,plan,ctx,weather?.humidity).excluded.length&&(modifier!=='comfort'||scoreColor(c.items).rule!=='complementary_overload'));
 if(!candidates.length){
  const needed=['top','bottom'].filter(k=>sets[k].length&&sets[k].every(i=>assessDressItem(i,ctx).excluded)).map(k=>({top:'상의',bottom:'하의'}[k])+' 1개');
  return{outfit:null,missing:['날씨·상황의 필수조건에 맞는 조합'],notices:[office?'출근은 깔끔한 캐주얼을 허용하지만 슬리퍼·운동복은 제외해요.':'오늘 일정의 필수 격식 조건을 충족하는 조합이 없어요.',...(!known?['날씨가 확인되지 않았어요.']:['현재 날씨의 필수조건도 함께 확인해주세요.']),...(needed.length?['일정에 맞는 '+needed.join('·')+'를 확인해주세요.']:[]),...(outerNeeded&&!sets.outer.length?['기온·실내 냉방을 고려하면 겉옷이 필요해요. 가지고 계신 겉옷을 추가해주세요.']:[])],total:0};
 }
 const chosen=candidates[Math.max(0,Math.min(skip,candidates.length-1))];
 const comfortAdjustment=comparison?comfortResult(chosen,comparison):null;
 const notices=[];
 if(office)notices.push(officePolicyReason);
 for(const item of chosen.items){const hint=garmentKindHint(item);if(hint)notices.push(item.name+': '+hint);}
 if(weather?.partial)notices.push((weather.missingPlaces||[]).join(' · ')+' 예보는 확인하지 못했어요. 확인된 지역 날씨만 반영한 조합이에요.');
 if([profile.dressCode,profile.walking,profile.exposure,profile.cooling,profile.heating].some(v=>v==null))notices.push('아직 모르는 생활 조건은 기본 기준으로 처리했어요. 생활과 취향에서 나중에 수정할 수 있어요.');
 if(chosen.items.some(i=>i.warmth==null))notices.push('보온 정도가 미확인인 옷이 있어요. 사진 분석만으로 날씨에 충분한 보온을 보장하지 않아요.');
 if(chosen.items.some(i=>i.formal==null))notices.push('격식 정보가 미확인인 옷이 있어요. 일정의 복장 조건과 비교해주세요.');
 if(outerNeeded&&!sets.outer.length)notices.push('기온·실내 냉방을 고려하면 겉옷이 필요해요. 가지고 계신 겉옷을 추가해주세요.');
 if(walkingComfort&&chosen.items.find(i=>i.category==='shoe')?.comfort!==true)notices.push('이 조합의 신발은 걷기 편하다는 확인이 없어요. 등록한 착용감을 확인해주세요.');
 if(!office&&formal>=1&&chosen.items.some(i=>['top','bottom','dress'].includes(i.category)&&Number(i.formal||0)<formal)){
  const names={top:'상의',bottom:'하의',dress:'원피스'};
  const needed=chosen.items.filter(i=>names[i.category]&&Number(i.formal||0)<formal).map(i=>names[i.category]+' 1개');
  notices.push('오늘 일정의 격식을 충분히 맞추기 어려워요. 가지고 계신 옷 중 일정에 맞는 '+needed.join('·')+'를 추가해주세요.');
 }
 if(!known)notices.push('날씨가 확인되지 않아 기온에 맞는 보온 조정은 하지 않았어요.');
 if(known&&plan.umbrella)notices.push('강수에 대비해 우산을 챙기세요. 신발의 방수 여부는 등록 정보로 확인할 수 없어요.');
 if(known&&plan.low<5)notices.push('현재 옷장의 겉옷만으로 충분히 따뜻한지는 확인이 필요해요. 겨울용 겉옷이 있다면 추가 등록해주세요.');
 const reasons=[];
 if(ctx.routine)reasons.push(`${ctx.routine}의 복장 조건을 함께 고려했어요.`);
 if(ctx.remote)reasons.push('오늘은 재택으로 입력되어 평소 출근 조건을 뺐어요.');
 if(ctx.autoHoliday)reasons.push(`${(ctx.holiday?.names||[]).join(' · ')||'공휴일'}을 휴일로 반영해 평소 출근·등교 조건을 뺐어요.`);
 else if(ctx.exception)reasons.push('오늘은 쉬는 일정으로 입력되어 평소 반복 활동을 뺐어요.');
 if(/약속|식사|미팅|면접|결혼식|발표/.test(ctx.text))reasons.push('오늘 입력한 약속과 격식 조건을 함께 고려했어요.');
 if(walkingComfort&&chosen.items.find(i=>i.category==='shoe')?.comfort===true)reasons.push('이동을 고려해 편하다고 등록한 신발을 함께 선택했어요.');
 if(known)reasons.push(plan.fallbackPlaces?.length?`${plan.fallbackPlaces.map(cityName).join(' · ')}의 기본 활동 시간 예보가 부족해 조회 가능한 기온 범위를 함께 참고했어요.`:plan.timeSpecific?`기본 활동 시간대의 ${Math.round(plan.low)}°~${Math.round(plan.high)}°를 고려했어요.`:weather.rangeKind==='forecast-hours'?`조회된 ${weather.fromHour}~${weather.throughHour}시 예보기온을 참고했어요.`:`시간별 정보가 없어 하루 최저 ${Math.round(weather.min)}° · 최고 ${Math.round(weather.max)}°를 참고했어요.`);
 if(outerNeeded&&sets.outer.length)reasons.push('기온과 체감 환경에 대비할 수 있도록 겉옷을 더했어요.');
 if(profile.fit&&chosen.items.some(i=>i.category!=='shoe'&&i.fit===profile.fit))reasons.push(profile.fit+'으로 등록한 옷을 함께 고려했어요.');
 if(useMoods&&chosen.moodMatch)reasons.push('기본 조건을 함께 고려하고, 고르신 느낌('+moodLabels(profile).join(' · ')+')에 연결되는 스타일로 등록한 옷을 참고했어요.');
 else if(!useMoods&&chosen.items.some(i=>stylePreferences(profile).includes(i.style)))reasons.push(stylePreferences(profile).join(' · ')+' 선호를 반영했어요.');
 if(ctx.warmthBias)reasons.push('최근 비슷한 기온에서 반복된 착용 피드백을 보온 정도에 반영했어요.');
 if(!reasons.length)reasons.push('등록한 옷의 기본 조건과 색상 조합을 고려했어요.');
 if(comfortAdjustment?.status==='confirmed')reasons.unshift('현재 코디에서 한 종류를 바꾸고 입력한 착용감도 반영했어요.');
 if(comfortAdjustment?.status==='provisional')reasons.unshift('옷의 종류·핏·스타일을 비교해 한 종류를 더 편한 성격의 후보로 바꿨어요. 실제 착용감은 다를 수 있어요.');
 return{outfit:chosen.items,missing:[],notices,reasons,total:candidates.length,signature:chosen.signature,...(comfortAdjustment?{comfortAdjustment}:{} )};
}
export function parseCapture(raw,offset){
 if(typeof raw!=='string')return null;
 const m=/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());if(!m)return null;
 const [y,mo,d,h,mi,s]=m.slice(1).map(Number);const check=new Date(Date.UTC(y,mo-1,d,h,mi,s));
 if(check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d||h>23||mi>59||s>59)return null;
 const validOffset=typeof offset==='string'&&/^[+-](0\d|1[0-4]):[0-5]\d$/.test(offset);
 const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
 return{raw:raw.trim(),offset:validOffset?offset:null,epoch:validOffset?Date.parse(iso+offset):check.getTime(),hasZone:validOffset};
}
export function captureGroups(items,gapMinutes=10){
 const sorted=items.filter(i=>i.capture&&Number.isFinite(i.capture.epoch)).sort((a,b)=>a.capture.epoch-b.capture.epoch);
 const groups=[];
 for(const item of sorted){const c=item.capture;const group=groups.find(g=>{
  const first=g[0].capture;
  if(!c.model||!first.model||c.model!==first.model||c.make!==first.make||c.hasZone!==first.hasZone)return false;
  if(c.epoch-first.epoch>gapMinutes*60000)return false;
  for(const k of ['flash','whiteBalance'])if(c[k]!=null&&first[k]!=null&&c[k]!==first[k])return false;
  return true;
 });if(group)group.push(item);else groups.push([item]);}
 return groups.filter(g=>g.length>1);
}

