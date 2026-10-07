import {weatherPlan} from './conditions.js';
import {garmentAttributes,assessTemperature,TEMPERATURE_RULE_DEFAULTS} from './recommendation-attributes.js';
import {createHash} from 'node:crypto';
import {scoreColor} from './recommendation-color.js';
import {normalizeRecommendationWeather,weatherSummary} from './recommendation-weather.mjs';
import {outfitComfort,garmentComfort,conditionChanges,garmentKindHint} from './outfit-comfort.js';
import {temperaturePreferences,stylePreferences} from './user-settings.js';
import {itemMoodMatch} from './style-taxonomy.js';
import {dressPolicy,assessDressItem,officePolicyReason} from './dress-policy.js';
const categories=['top','bottom','dress','shoe','outer'];
const labels={top:'상의',bottom:'하의',dress:'원피스',shoe:'신발',outer:'겉옷'};
const signature=items=>JSON.stringify(items.map(i=>String(i.id)).sort());
const candidateId=items=>'look-'+createHash('sha256').update(signature(items)).digest('hex').slice(0,32);
const coreSignature=items=>signature(items.filter(i=>['top','bottom','dress'].includes(i.category)));
export const RECOMMENDATION_RULE_DEFAULTS=TEMPERATURE_RULE_DEFAULTS;
const compare=(a,b)=>(Number.isFinite(a.comfortPriority)&&Number.isFinite(b.comfortPriority)?b.comfortPriority-a.comfortPriority:0)||b.score-a.score||a.signature.localeCompare(b.signature);
const formalValue=items=>items.reduce((sum,i)=>sum+(garmentAttributes(i).formal??0)*(i.category==='dress'?2:1),0)/items.reduce((n,i)=>n+(i.category==='dress'?2:1),0);
function pairChange(items,reference){const removed=reference.filter(i=>!items.some(j=>i.id===j.id)),added=items.filter(i=>!reference.some(j=>i.id===j.id));return removed.length===1&&added.length===1&&removed[0].category===added[0].category?{old:removed[0],next:added[0]}:null;}
function offer(pool,candidate,limit,perCoreLimit=limit){
 const core=coreSignature(candidate.items),sameCore=pool.filter(c=>coreSignature(c.items)===core);
 if(sameCore.length>=perCoreLimit){const last=sameCore.at(-1);if(compare(candidate,last)>=0)return;pool.splice(pool.indexOf(last),1);}
 if(pool.length>=limit&&compare(candidate,pool.at(-1))>=0)return;
 let low=0,high=pool.length;while(low<high){const middle=(low+high)>>1;if(compare(candidate,pool[middle])<0)high=middle;else low=middle+1;}
 pool.splice(low,0,candidate);if(pool.length>limit)pool.pop();
}
function diverse(pool,k){
 const remaining=[...pool],chosen=[],usedCore=new Set();
 while(remaining.length&&chosen.length<k){const unseen=remaining.some(c=>!usedCore.has(coreSignature(c.items)));let bestIndex=0,best=-Infinity;for(let i=0;i<remaining.length;i++){const c=remaining[i];if(unseen&&usedCore.has(coreSignature(c.items)))continue;const similarity=chosen.length?Math.max(...chosen.map(p=>c.items.filter(j=>p.items.some(x=>x.id===j.id)).length/Math.max(c.items.length,p.items.length))):0;const value=c.score-similarity*12;if(value>best){best=value;bestIndex=i;}}const selected=remaining.splice(bestIndex,1)[0];chosen.push(selected);usedCore.add(coreSignature(selected.items));}
 return chosen;
}
/** Pure local rules. No Gemini, network, storage writes, or mutation of input garments. */
export function createRuleRecommendations(wardrobe,profile={},context={},weather=null,options={}){
 const ctx={...context,text:context.text||'',formal:Number(context.formal)||0,sensitivities:context.sensitivities||temperaturePreferences(profile),cooling:context.cooling??profile.cooling};
 const normalized=normalizeRecommendationWeather(weather),plan=weatherPlan(normalized,ctx),summary=weatherSummary(normalized);
 const limit=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
 const topK=limit(options.topK,5,1,20),poolLimit=limit(options.poolLimit,160,Math.max(topK,20),512),maxCandidates=limit(options.maxCandidates,100000,1,500000);
 const ruleConfig={warmThreshold:limit(options.ruleConfig?.warmThreshold,23,15,40),coldThreshold:limit(options.ruleConfig?.coldThreshold,12,-20,20)};
 const excludedCounts={},exclude=code=>{excludedCounts[code]=(excludedCounts[code]||0)+1;},seen=new Set(),available=[];
 for(const item of Array.isArray(wardrobe)?wardrobe:[]){if(!item||item.id==null||!categories.includes(item.category)){exclude('invalid_item');continue;}if(seen.has(item.id)){exclude('duplicate_item');continue;}seen.add(item.id);if(item.available===false||item.candidate){exclude('unavailable_item');continue;}available.push(item);}
 // Sort only copies to keep deterministic output without reordering caller data.
 available.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const sets=Object.fromEntries(categories.map(k=>[k,available.filter(i=>i.category===k)]));
 const required=available.find(i=>i.id===options.requiredId);
 if(options.requiredId!=null){
  if(!required){for(const k of categories)sets[k]=[];exclude('required_item');}
  else {sets[required.category]=[required];if(['top','bottom'].includes(required.category))sets.dress=[];if(required.category==='dress'){sets.top=[];sets.bottom=[];}}
 }
 const outerOptions=required?.category==='outer'?[required]:[null,...sets.outer];
 const totalCombinations=(sets.dress.length+sets.top.length*sets.bottom.length)*sets.shoe.length*outerOptions.length;
 const referenceIds=Array.isArray(options.referenceIds)?options.referenceIds:[],reference=referenceIds.map(id=>available.find(i=>i.id===id)).filter(Boolean);
 const refCounts=Object.fromEntries(categories.map(k=>[k,reference.filter(i=>i.category===k).length]));
 const validStructure=refCounts.shoe===1&&refCounts.outer<=1&&(refCounts.dress===1&&refCounts.top===0&&refCounts.bottom===0||refCounts.dress===0&&refCounts.top===1&&refCounts.bottom===1);
 const hasReference=reference.length===referenceIds.length&&new Set(referenceIds).size===referenceIds.length&&validStructure,referenceSignature=hasReference?signature(reference):null,baseline=hasReference?outfitComfort(reference):null;
 const history=(options.history||[]).filter(h=>Array.isArray(h?.ids)||Array.isArray(h?.itemIds)),historySignatures=new Set(history.map(h=>signature((h.ids||h.itemIds).map(id=>({id})))));
 const recent=new Set(history.slice(-3).flatMap(h=>h.ids||h.itemIds));
 const modifier=options.modifier||'',pool=[],alternatives=[],blockedReasons=new Set();let referenceCandidate=null,candidatesGenerated=0,candidatesAfterFilter=0,eligibleCount=0;
 const evaluate=items=>{
  const reasons=[],notices=[],excluded=[];const color=scoreColor(items),temperature=assessTemperature(items,plan,ctx,summary.humidity,ruleConfig);let preference=0,formality=0;
  if(options.requiredId!=null&&!items.some(i=>i.id===options.requiredId))excluded.push('required_item');
  for(const item of items){const dress=assessDressItem(item,ctx);if(dress.excluded)excluded.push(dress.excluded);if(dress.unknown)notices.push(item.name+': 격식이 모름이라 일정의 복장 조건을 확인해주세요.');formality+=dress.penalty;if(item.category!=='shoe'&&profile.fit&&profile.fit===item.fit)preference+=2;if(stylePreferences(profile).includes(item.style))preference+=1;if(itemMoodMatch(item,profile))preference+=1;if(item.category==='shoe'&&ctx.walking>=15)preference+=item.comfort===true?5:item.comfort===false?-8:0;const hint=garmentKindHint(item);if(hint)notices.push(item.name+': '+hint);}
  excluded.push(...temperature.excluded.map(e=>e.code));
  if(excluded.length)return {excluded:[...new Set(excluded)]};
  reasons.push(...color.reasons,...temperature.reasons);notices.push(...temperature.unknown);
  if(dressPolicy(ctx).mode==='neat-casual-office')reasons.push(officePolicyReason);
  const historyPenalty=items.filter(i=>recent.has(i.id)).length*.3;
  const scores={color:color.score,temperature:temperature.score,formality,preference,history:-historyPenalty,total:color.score+temperature.score+formality+preference-historyPenalty};
  return {items,signature:signature(items),score:scores.total,scores,colorRule:color.rule,scoreReasons:reasons,reasons,notices:[...new Set(notices)],formal:formalValue(items)};
 };
 const consider=items=>{
  candidatesGenerated++;const candidate=evaluate(items);if(candidate.excluded){candidate.excluded.forEach(exclude);return;}candidatesAfterFilter++;
  if(candidate.signature===referenceSignature)referenceCandidate=candidate;
  if(modifier==='comfort'&&hasReference){
   const pair=pairChange(items,reference);if(!pair){if(candidate.signature!==referenceSignature)exclude('comfort_one_category');return;}
   const metrics=outfitComfort(items),blocked=conditionChanges(items,reference,ctx,plan),improves=pair.next.comfort!==false&&metrics.uncomfortable<=baseline.uncomfortable&&metrics.score>baseline.score;
   const details=garmentComfort(pair.next),reasons=[];
   if(!improves)reasons.push('등록된 종류·핏·착용감으로 비교하면 현재 옷보다 편안함 점수가 높지 않아요.');
   for(const code of blocked){blockedReasons.add(code);reasons.push(({formal:'필수 격식',warmth:'보온',walking:'도보 착용감',structure:'옷 구성',color:'큰 색 충돌'}[code]||code)+' 조건을 유지하는지 확인이 필요해요.');}
   if(alternatives.length<300)alternatives.push({id:pair.next.id,name:pair.next.name,category:labels[pair.next.category],from:pair.old.name,eligible:improves&&!blocked.length,basis:details.reasons,reasons,itemType:pair.next.itemType||'',kindHint:garmentKindHint(pair.next)});
   if(!improves||blocked.length){exclude(blocked.length?'comfort_condition':'comfort_no_improvement');return;}
   candidate.pair=pair;candidate.comfortMetrics=metrics;candidate.comfortBasis=pair.old.comfort===false||pair.next.comfort===true&&pair.old.comfort!==true?'confirmed':'provisional';
   // Hard conditions (including clear color conflict) have passed. Comfort is
   // lexicographically first; color/other scores only break comfort ties.
   candidate.comfortPriority=metrics.score;candidate.scores.comfort=metrics.score;
   candidate.scoreReasons.unshift('날씨·상황 조건과 큰 색 충돌 여부를 확인한 뒤 편안함을 먼저 비교했어요.');
  }else if(modifier==='formal'){
   if(hasReference&&(candidate.signature===referenceSignature||candidate.formal<formalValue(reference))){exclude('formal_no_progress');return;}
   const improvement=candidate.formal-(hasReference?formalValue(reference):ctx.formal);
   candidate.score+=Math.max(0,improvement)*15;candidate.scores.adjustment=candidate.score-candidate.scores.total;candidate.scores.total=candidate.score;
  }
  if((modifier==='formal'||modifier==='other'||modifier==='alternative')&&(historySignatures.has(candidate.signature)||candidate.signature===referenceSignature)){exclude('already_shown');return;}
  eligibleCount++;offer(pool,candidate,poolLimit,Math.max(topK,Math.ceil(poolLimit/topK)));
 };
 // Streaming Cartesian product: the full base product is never materialized.
 function* bases(){for(const dress of sets.dress)yield[dress];for(const top of sets.top)for(const bottom of sets.bottom)yield[top,bottom];}
 outer:for(const base of bases())for(const shoe of sets.shoe)for(const outer of outerOptions){if(candidatesGenerated>=maxCandidates)break outer;consider([...base,shoe,...(outer?[outer]:[])]);}
 if(hasReference&&!referenceCandidate){const evaluated=evaluate(reference);if(!evaluated.excluded)referenceCandidate=evaluated;}
 const warnings=[];if(candidatesGenerated<totalCombinations)warnings.push('조합 수가 계산 상한을 넘어 일부 조합만 확인했어요.');
 if(!plan.known)warnings.push('날씨가 확인되지 않아 기온에 따른 제외는 적용하지 않았어요.');
 if(normalized?.partial)warnings.push('일부 활동 지역의 예보가 없어 확인된 지역만 반영했어요.');
 if(!pool.length&&referenceCandidate&&['comfort','formal','other','alternative'].includes(modifier)){offer(pool,referenceCandidate,poolLimit);warnings.push('현재 조건에서 아직 보지 않은 더 나은 후보가 없어 현재 코디를 유지했어요.');}
 const ranked=modifier==='comfort'?[...pool].sort(compare):diverse(pool,pool.length),skip=limit(options.skip,0,0,Number.MAX_SAFE_INTEGER),selected=ranked.length?ranked[skip%ranked.length]:null;
 const displayed=selected?[selected,...ranked.filter(c=>c!==selected)].slice(0,topK):[];
 const comfortAdjustment=modifier==='comfort'&&hasReference&&selected?{status:selected.comfortBasis||'unchanged',changedCategories:selected.pair?[labels[selected.pair.next.category]]:[],unknownCategories:[...new Set(selected.items.filter(i=>typeof i.comfort!=='boolean').map(i=>labels[i.category]))],change:selected.pair?{category:labels[selected.pair.next.category],from:selected.pair.old.name,to:selected.pair.next.name,reasons:garmentComfort(selected.pair.next).reasons}:null,baseline,metrics:selected.comfortMetrics||outfitComfort(selected.items),blockedReasons:[...blockedReasons],alternatives:alternatives.map(a=>({...a,selected:selected.pair?.next.id===a.id}))}:null;
 const looks=displayed.map(c=>({candidateId:candidateId(c.items),itemIds:c.items.map(i=>i.id),scores:c.scores,score:c.score,scoreReasons:c.scoreReasons,stylingTip:c.scoreReasons[0]||'등록한 옷과 오늘 조건을 함께 고려한 조합이에요.',reasons:c.reasons,notices:c.notices,scoreBreakdown:{...c.scores,colorRule:c.colorRule},...(c===selected&&comfortAdjustment?{comfortAdjustment}:{})}));
 const formalAdjustment=modifier==='formal'&&hasReference&&selected?{status:selected.signature===referenceSignature?'unchanged':selected.formal>formalValue(reference)?'improved':'alternative',before:formalValue(reference),after:selected.formal,message:selected.signature===referenceSignature?'더 단정한 새로운 후보가 없어 현재 코디를 유지했어요.':selected.formal>formalValue(reference)?'등록된 격식 점수가 더 높은 조합이에요.':'현재 격식을 유지하는 다른 조합이에요.'}:null;
 const missing=[];if(!sets.dress.length){if(!sets.top.length)missing.push('상의');if(!sets.bottom.length)missing.push('하의');}if(!sets.shoe.length)missing.push('신발');if(!looks.length&&!missing.length)missing.push('현재 필수 조건을 충족하는 조합');
 return {source:'rules',selectedLookId:looks[0]?.candidateId||null,weather:summary,looks,warnings,validCandidateCount:eligibleCount||pool.length,...(comfortAdjustment?{comfortAdjustment}:{}),...(formalAdjustment?{formalAdjustment}:{}),diagnostics:{candidatesGenerated,candidatesAfterFilter,topKCount:looks.length,excludedCounts,preferencePolicy:{dress:dressPolicy(ctx).mode,ranking:modifier==='comfort'?'comfort-first-color-tiebreak':'combined',colorGuard:'registered-complementary-overload'},climatePolicy:{basis:'activity-temperature',seasonInferred:false,thresholds:ruleConfig},search:{totalCombinations,maxCandidates,poolLimit,poolSize:pool.length,eligibleCount,limitReached:candidatesGenerated<totalCombinations},timingsMs:{server:null,weatherCacheRead:null,weatherProvider:null,gemini:null},gemini:{called:false,cached:false,model:null,usage:null}},legacyResult:{outfit:selected?.items||null,missing,notices:[...(selected?.notices||[]),...warnings],reasons:selected?.reasons||[],total:eligibleCount||pool.length,signature:selected?.signature||null,...(comfortAdjustment?{comfortAdjustment}:{})}};
}
