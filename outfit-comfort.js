// Whole-outfit comparison. Style/fit are provisional clues, never physical facts.
import {styleMoodEntries} from './style-taxonomy.js';
import {dressPolicy,assessDressItem} from './dress-policy.js';
import {scoreColor} from './recommendation-color.js';
const labels={top:'상의',bottom:'하의',dress:'원피스',shoe:'신발',outer:'겉옷'};
const casualStyles=new Set(['캐주얼',...styleMoodEntries.filter(s=>['natural','active'].includes(s.primaryMood)).map(s=>s.style)]);
const weight=item=>item.category==='dress'?2:1;
const sameItems=(a,b)=>a.length===b.length&&a.every(i=>b.some(j=>j.id===i.id));
// Specific garment kinds take precedence over construction details (hood/zip/collar).
// Generic AI labels can be supplemented by the saved name. Physical values stay untouched.
export function garmentKind(item){
 const compact=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
 const rules={
  top:[[4,/맨투맨|스웨트|후드/,'맨투맨·후드 계열',true],[2,/티셔츠|티-?셔츠/,'티셔츠 계열',true],[1,/니트|스웨터/,'니트·스웨터 계열',true],[0,/셔츠|블라우스/,'셔츠·블라우스 계열',true]],
  bottom:[[4,/조거|트레이닝|스웨트/,'조거·트레이닝 계열',true],[2,/카고|치노/,'카고·치노 계열',true],[1,/데님|청바지|^진(?:팬츠|바지|즈)|흑청|진청|중청|연청|(?:블랙|화이트|블루|인디고)진(?:$|팬츠|바지)|^진$|\bjeans\b/,'데님·청바지 계열',true],[0,/슬랙스/,'슬랙스 계열',true],[0,/팬츠|바지/,'일반 팬츠 계열',false]],
  dress:[[2,/니트|티셔츠|스웨트/,'니트·티셔츠형 원피스',true]],
  outer:[[0,/패딩|다운재킷|다운자켓|다운점퍼|푸퍼|puffer/,'패딩 계열',true],[3,/바람막이|윈드브레이커|윈드재킷|윈드자켓|windbreaker/,'바람막이 계열',true],[3,/가디건/,'가디건 계열',true],[1,/데님|청재킷|청자켓/,'데님 재킷 계열',true],[0,/블레이저|정장재킷|정장자켓|코트/,'코트·블레이저 계열',true],[3,/후드|집업/,'후드·집업 계열',false],[1,/카라|블루종/,'일상용 재킷 계열',false]],
  shoe:[[-2,/하이힐|스틸레토|펌프스/,'굽 있는 구두 계열',true],[4,/운동화|러닝화/,'운동화 계열',true],[3,/스니커즈/,'스니커즈 계열',true],[1,/플랫|단화/,'단화 계열',true]]
 };
 const match=value=>(rules[item.category]||[]).find(([,re])=>re.test(compact(value)));
 const type=match(item.itemType),name=match(item.name);
 const fromName=!type?.[3]&&!!name?.[3]||!type&&!!name;
 const selected=fromName?name:type;
 return selected?{score:selected[0],label:selected[2],specific:selected[3],source:fromName?'name':'itemType',conflict:!!(type?.[3]&&name?.[3]&&type[2]!==name[2])}:{score:0,label:null,specific:false,source:null,conflict:false};
}
export function garmentKindHint(item){
 const kind=garmentKind(item);
 if(kind.conflict)return '옷 이름과 세부 종류가 달라요. 세부 종류를 우선해 비교했어요.';
 if(kind.specific)return '';
 return item.category==='bottom'?'팬츠라는 정보만으로 청바지·슬랙스 등을 구별하기 어려워요. 세부 종류를 확인하면 비교가 더 정확해져요.':item.category==='outer'?'재킷·후드·집업만으로 패딩과 바람막이를 구별하기 어려워요. 세부 종류를 확인하면 비교가 더 정확해져요.':'';
}
// MVP heuristics describe a garment, not measured material, stretch or actual fit.
export function garmentComfort(item){
 const kind=garmentKind(item),fit=(item.fit||'').replace(/\s/g,''),reasons=[];
 let score=0;
 if(kind.label){score+=kind.score;reasons.push(kind.label+(kind.source==='name'?' (옷 이름 참고)':''));}
 if(item.category!=='shoe'){
  if(/여유|루즈|오버핏|오버사이즈|릴랙스|와이드/.test(fit)){score+=3;reasons.push('여유 있는 핏');}
  else if(/타이트|스키니|슬림|몸에맞|밀착/.test(fit)){score-=1;reasons.push('몸에 붙는 핏');}
 }
 if(casualStyles.has(item.style)){score+=.5;reasons.push('자연스러운·활동적인 스타일');}
 const estimatedScore=score;
 if(item.comfort===false)return {score:-10,estimatedScore,reasons:['직접 불편하다고 등록'],basis:'manual',kind};
 if(item.comfort===true){score+=2;reasons.push('직접 편하다고 등록');}
 return {score,estimatedScore,reasons,basis:typeof item.comfort==='boolean'?'manual':reasons.length?'estimated':'unknown',kind};
}
export function outfitComfort(items){
 return items.reduce((m,item)=>{
  const w=weight(item),c=garmentComfort(item);m.score+=c.score*w;m.relaxed+=c.estimatedScore*w;if(c.basis!=='unknown')m.clues+=w;
  if(item.comfort===false)m.uncomfortable+=w;else if(item.comfort===true)m.comfortable+=w;else m.unknown+=w;
  return m;
 },{uncomfortable:0,comfortable:0,unknown:0,relaxed:0,score:0,clues:0});
}
function slots(items){
 const result={};for(const item of items){if(item.category==='dress'){result.top=item;result.bottom=item;}else result[item.category]=item;}return result;
}
export function conditionChanges(candidate,reference,ctx,plan){
 const a=slots(candidate),b=slots(reference),blocked=new Set();
 if(scoreColor(candidate).rule==='complementary_overload')blocked.add('color');
 for(const [slot,old] of Object.entries(b)){
  const next=a[slot];if(!next){blocked.add('structure');continue;}
  const deficit=item=>Math.max(0,Number(ctx.formal||0)-Number(item.formal||0));
  if(dressPolicy(ctx).mode==='neat-casual-office'?assessDressItem(next,ctx).excluded:deficit(next)>deficit(old))blocked.add('formal');
  if(plan.known&&['top','bottom','outer'].includes(slot)){
   const target=slot==='outer'?plan.outerTarget:plan.baseTarget;
   if(old.warmth!=null){
    if(next.warmth==null||Math.abs(Number(next.warmth)-target)>Math.abs(Number(old.warmth)-target))blocked.add('warmth');
   }else if(next.warmth!=null&&Math.abs(Number(next.warmth)-target)>.5)blocked.add('warmth');
  }
  // A walking-friendly shoe already confirmed should not become unconfirmed.
  if(slot==='shoe'&&ctx.walking>=15&&old.comfort===true&&next.comfort!==true)blocked.add('walking');
 }
 return [...blocked];
}
function replacedPair(candidate,reference){
 const removed=reference.filter(i=>!candidate.some(j=>j.id===i.id)),added=candidate.filter(i=>!reference.some(j=>j.id===i.id));
 // One tap changes one garment in the same role; dress to separates is for Other outfits.
 return removed.length===1&&added.length===1&&removed[0].category===added[0].category?{old:removed[0],next:added[0]}:null;
}
export function comfortCandidates(ranked,referenceIds,ctx,plan){
 const reference=ranked.find(c=>sameItems(c.items,(referenceIds||[]).map(id=>({id}))))||ranked[0];
 const baseline=outfitComfort(reference.items),allowed=[],better=[],blockedReasons=new Set(),alternatives=[];
 for(const candidate of ranked){
  const metrics=outfitComfort(candidate.items),pair=replacedPair(candidate.items,reference.items);
  const improves=pair&&pair.next.comfort!==false&&metrics.uncomfortable<=baseline.uncomfortable&&metrics.score>baseline.score;
  const blocked=conditionChanges(candidate.items,reference.items,ctx,plan);
  if(pair){
   const details=garmentComfort(pair.next),reasons=[];
   if(pair.next.comfort===false)reasons.push('직접 불편하다고 등록한 옷이에요.');
   if(blocked.includes('formal'))reasons.push('등록된 격식으로는 오늘 일정의 복장 조건을 현재 옷보다 덜 충족해요.');
   if(blocked.includes('color'))reasons.push('등록된 색상 정보에서 선명한 보색이 여러 옷에 겹치는 큰 색 충돌이 확인됐어요.');
   if(blocked.includes('warmth'))reasons.push(pair.next.warmth==null?'보온이 아직 모름이라 현재 옷의 보온 조건을 유지하는지 확인할 수 없어요.':'등록된 보온이 현재 날씨 기준과 더 멀어져요.');
   if(blocked.includes('walking'))reasons.push('많이 걷는 날이라 편하다고 확인된 현재 신발을 유지해요.');
   if(!improves&&!reasons.length)reasons.push(details.basis==='unknown'?'종류·핏·스타일 정보로 더 편한 후보인지 구분하기 어려워요.':'종류·핏·스타일과 입력한 착용감을 함께 비교하면 현재 옷보다 편안함 점수가 높지 않아요.');
   if(details.kind.conflict)reasons.push('옷 이름과 세부 종류가 달라 세부 종류를 우선했어요. 옷 정보에서 확인해주세요.');
   alternatives.push({id:pair.next.id,name:pair.next.name,category:labels[pair.next.category],from:pair.old.name,eligible:!!improves&&!blocked.length,basis:details.reasons,reasons,itemType:pair.next.itemType||'',kindHint:garmentKindHint(pair.next)});
  }
  if(blocked.length){if(improves)blocked.forEach(r=>blockedReasons.add(r));continue;}
  const confirmed=improves&&(pair.old.comfort===false||(pair.next.comfort===true&&pair.old.comfort!==true));
  const entry={...candidate,comfortMetrics:metrics,comfortBasis:improves?(confirmed?'confirmed':'provisional'):null};
  allowed.push(entry);if(improves)better.push(entry);
 }
 // Largest one-role improvement first; original coordination ranking breaks ties.
 better.sort((a,b)=>b.comfortMetrics.score-a.comfortMetrics.score);
 const first=better.length?better:allowed.filter(c=>c.signature===reference.signature),firstIds=new Set(first.map(c=>c.signature));
 return {ranked:[...first,...allowed.filter(c=>!firstIds.has(c.signature))],reference,baseline,blockedReasons:[...blockedReasons],alternatives};
}
export function comfortResult(chosen,comparison){
 const changed=chosen.items.filter(i=>!comparison.reference.items.some(j=>j.id===i.id)),pair=replacedPair(chosen.items,comparison.reference.items);
 return {status:chosen.signature===comparison.reference.signature?'unchanged':chosen.comfortBasis||'comparable',
  changedCategories:[...new Set(changed.map(i=>labels[i.category]))],
  unknownCategories:[...new Set(chosen.items.filter(i=>typeof i.comfort!=='boolean').map(i=>labels[i.category]))],
  change:pair?{category:labels[pair.next.category],from:pair.old.name,to:pair.next.name,reasons:garmentComfort(pair.next).reasons}:null,
  baseline:comparison.baseline,metrics:chosen.comfortMetrics,blockedReasons:comparison.blockedReasons,
  alternatives:comparison.alternatives.map(a=>({...a,selected:!!pair&&pair.next.id===a.id}))};
}
export function comfortAdjustmentMessage(_closet,_ctx,result){
 const a=result?.comfortAdjustment;if(!a)return '옷의 종류·핏·스타일을 비교해 한 종류씩 바꿔요.';
 if(['confirmed','provisional'].includes(a.status)){
  const change=a.change,reason=(change?.reasons||[]).join(' · ');
  return `${change?.category||a.changedCategories.join('·')}: ${change?.from||'기존 옷'} → ${change?.to||'새 후보'}. ${reason?'비교 기준: '+reason+'. ':''}`+(a.status==='provisional'?'옷의 성격으로 추정한 후보이며 실제 착용감은 다를 수 있어요.':'입력한 착용감도 반영했어요.')+' 다시 누르면 현재 코디에서 한 종류씩 더 비교해요.';
 }
 if(a.status==='comparable')return '오늘 조건을 유지하는 다른 조합이에요. 더 편하게 바꾸는 단계와는 별도로 살펴볼 수 있어요.';
 if(a.blockedReasons.length){const conditions=a.blockedReasons.map(r=>({formal:'일정의 격식',warmth:'날씨의 보온',walking:'도보에 필요한 신발 착용감',structure:'필요한 옷 구성',color:'큰 색 충돌을 피하는 배색'}[r])).join('·');return '더 편한 후보가 '+conditions+' 조건을 유지하지 못해 현재 조합을 유지했어요.';}
 const noClues=a.metrics.clues===0;
 return noClues?'옷의 종류·핏·스타일이 아직 모름이라 한 단계 더 편한 후보를 구분하기 어려워요. 착용감 입력 없이도 옷의 성격이 등록되면 비교할 수 있어요.':'현재 코디에서 한 종류만 바꿔 더 편하게 만들 수 있는 후보를 모두 확인했어요. 오늘 조건에서 더 나은 대안이 없어 현재 조합을 유지했어요.';
}
export function comfortTag(result){
 const status=result?.comfortAdjustment?.status;
 return status==='confirmed'?'착용감도 반영해 한 종류 교체':status==='provisional'?'옷의 성격으로 한 종류 교체':'현재 코디의 편안함을 비교했어요';
}
