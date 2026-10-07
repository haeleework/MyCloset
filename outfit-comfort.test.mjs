import test from 'node:test';
import assert from 'node:assert/strict';
import {recommend,comfortAdjustmentMessage} from './engine.js';
import {outfitComfort,conditionChanges,garmentComfort} from './outfit-comfort.js';
const profile={routine:'출근',days:[1,2,3,4,5],dressCode:1,walking:0,cooling:false,heating:false,exposure:'mixed',fit:'',moodPreferences:[]};
const ctx={formal:1,walking:0,text:'',exposure:'mixed',sensitivities:[]};
const weather={min:15,max:24};
const base=()=>['top','bottom','shoe','outer'].map((category,i)=>({id:'0-'+category,name:['기본 상의','슬랙스','기본 신발','기본 재킷'][i],category,color:'검정',warmth:1,formal:1,comfort:false,available:true}));
const change=(item,extra={})=>({...item,id:'1-'+item.category,name:'편한 '+item.category,comfort:true,...extra});
const ids=items=>items.map(i=>i.id);
function adjust(pool,reference,context=ctx,w=weather,options={}){return recommend(pool,profile,context,w,{modifier:'comfort',referenceIds:ids(reference),...options});}
for(const category of ['top','bottom','shoe','outer'])test('전체 비교에서 '+category+'만 더 편한 옷으로 바꿀 수 있다',()=>{
 const reference=base(),old=reference.find(i=>i.category===category),alternative=change(old);
 const result=adjust([...reference,alternative],reference);
 assert.equal(result.outfit.find(i=>i.category===category).id,alternative.id);
 assert.deepEqual(result.outfit.filter(i=>i.category!==category).map(i=>i.id),reference.filter(i=>i.category!==category).map(i=>i.id));
 assert.equal(result.comfortAdjustment.status,'confirmed');assert.equal(result.comfortAdjustment.metrics.uncomfortable,3);
 assert.match(comfortAdjustmentMessage([],ctx,result),/입력한 착용감도 반영/);
});
test('누를 때마다 한 종류만 개선하고 네 번 뒤 최적 조합에서 멈춘다',()=>{
 const reference=base(),pool=[...reference,...reference.map(i=>change(i))];let previous=reference,score=outfitComfort(reference).score;
 const seen=new Set([ids(reference).join('|')]);
 for(let n=0;n<4;n++){
  const result=adjust(pool,previous);assert.equal(result.comfortAdjustment.changedCategories.length,1);
  assert.equal(result.outfit.filter(i=>!previous.some(j=>j.id===i.id)).length,1);
  assert.ok(result.comfortAdjustment.metrics.score>score);assert.ok(!seen.has(result.signature));seen.add(result.signature);
  previous=result.outfit;score=result.comfortAdjustment.metrics.score;
 }
 assert.deepEqual(ids(previous),reference.map(i=>'1-'+i.category));
 assert.equal(adjust(pool,previous).comfortAdjustment.status,'unchanged');
});
test('도보로 이미 편한 신발을 골랐어도 다른 세 종류를 한 번씩 개선한다',()=>{
 const reference=base().map(i=>i.category==='shoe'?{...i,comfort:true}:i);
 const pool=[...reference,...reference.filter(i=>i.category!=='shoe').map(i=>change(i))];let previous=reference;
 for(let n=0;n<3;n++){
  const result=adjust(pool,previous,{...ctx,walking:30});assert.equal(result.outfit.find(i=>i.category==='shoe').id,'0-shoe');
  assert.equal(result.comfortAdjustment.changedCategories.length,1);assert.equal(result.comfortAdjustment.status,'confirmed');previous=result.outfit;
 }
 assert.equal(outfitComfort(previous).comfortable,4);
});
test('격식이 필요한 일정에서 더 편하다는 이유로 복장 조건을 낮추지 않는다',()=>{
 const reference=base().map(i=>({...i,formal:2})),pool=[...reference,...reference.map(i=>change(i,{formal:1}))];
 const result=adjust(pool,reference,{...ctx,formal:2,text:'면접'});
 assert.deepEqual(ids(result.outfit),ids(reference));assert.deepEqual(result.comfortAdjustment.blockedReasons,['formal']);
 assert.match(comfortAdjustmentMessage([],ctx,result),/일정의 격식/);
});
test('추운 날 더 편한 얇은 겉옷으로 보온을 낮추지 않는다',()=>{
 const reference=base().map(i=>({...i,warmth:2})),outer=reference.find(i=>i.category==='outer');
 const result=adjust([...reference,change(outer,{warmth:0})],reference,ctx,{min:0,max:8});
 assert.equal(result.outfit.find(i=>i.category==='outer').id,outer.id);assert.ok(result.comfortAdjustment.blockedReasons.includes('warmth'));
 assert.match(comfortAdjustmentMessage([],ctx,result),/보온/);
});
test('확인된 보온을 모름으로 대체하거나 도보용 편한 신발을 불편한 신발로 바꾸지 않는다',()=>{
 const reference=base().map(i=>i.category==='shoe'?{...i,comfort:true}:i);
 const top=reference.find(i=>i.category==='top');
 assert.ok(conditionChanges([change(top,{warmth:null}),...reference.filter(i=>i.category!=='top')],reference,ctx,{known:true,baseTarget:1,outerTarget:1}).includes('warmth'));
 const shoe=reference.find(i=>i.category==='shoe');
 assert.ok(conditionChanges([...reference.filter(i=>i.category!=='shoe'),change(shoe,{comfort:false})],reference,{...ctx,walking:30},{known:false}).includes('walking'));
});
test('모름인 여유핏·캐주얼 후보는 제안하되 실제 착용감 개선으로 확정하지 않는다',()=>{
 const reference=base().map(i=>({...i,comfort:null})),old=reference.find(i=>i.category==='top');
 const candidate=change(old,{comfort:null,fit:'여유 있는 핏',style:'톰보이',itemType:'맨투맨'});
 const result=adjust([...reference,candidate],reference);
 assert.equal(result.outfit.find(i=>i.category==='top').id,candidate.id);assert.equal(result.comfortAdjustment.status,'provisional');
 assert.equal(result.comfortAdjustment.metrics.comfortable,0);assert.match(comfortAdjustmentMessage([],ctx,result),/실제 착용감은 다를 수/);
});
test('불편하다고 확인한 옷을 여유핏·스포티라는 이유로 편하다고 추측하지 않는다',()=>{
 const reference=base().map(i=>({...i,comfort:true})),old=reference.find(i=>i.category==='top');
 const result=adjust([...reference,change(old,{comfort:false,fit:'오버핏',style:'스포티',itemType:'후드'})],reference);
 assert.deepEqual(ids(result.outfit),ids(reference));assert.equal(result.comfortAdjustment.status,'unchanged');
});
test('모든 착용감·핏·스타일이 모름이면 옷 부족 대신 조합 전체의 정보 부족을 안내한다',()=>{
 const reference=base().map(i=>({...i,name:'등록 옷',comfort:null}));
 const result=adjust([...reference,change(reference[0],{comfort:null})],reference);
 assert.deepEqual(ids(result.outfit),ids(reference));assert.match(comfortAdjustmentMessage([],ctx,result),/옷의 종류·핏·스타일/);
 assert.match(comfortAdjustmentMessage([],ctx,result),/착용감 입력 없이도/);assert.equal(outfitComfort(reference).comfortable,0);
});
test('더 편한 대안이 없으면 유지하고 다른 조합 버튼의 후보는 보존한다',()=>{
 const reference=base().map(i=>({...i,comfort:true})),pool=[...reference,...reference.map(i=>change(i))];
 const repeated=adjust(pool,reference);assert.deepEqual(ids(repeated.outfit),ids(reference));assert.equal(repeated.comfortAdjustment.status,'unchanged');
 const next=adjust(pool,reference,ctx,weather,{skip:1});assert.notEqual(next.signature,repeated.signature);assert.ok(next.total>1);
});
test('원피스는 두 역할로 평가하지만 한 번 교체에서 상하의를 원피스로 동시에 바꾸지 않는다',()=>{
 const reference=base(),dress={id:'dress',name:'원피스',category:'dress',color:'검정',warmth:1,formal:1,comfort:true,available:true};
 const pool=[...reference,dress];assert.deepEqual(ids(adjust(pool,reference).outfit),ids(reference));
 const original=[{...dress,id:'d0',comfort:null,itemType:'정장 원피스'},...reference.filter(i=>['shoe','outer'].includes(i.category))];
 const next={...dress,comfort:null,itemType:'티셔츠 원피스',fit:'여유핏'};
 const result=adjust([...original,next],original);assert.equal(result.comfortAdjustment.changedCategories.length,1);assert.ok(result.outfit.some(i=>i.id==='dress'));
 assert.equal(outfitComfort([next]).unknown,2);assert.ok(result.outfit.every(i=>[...original,next].some(j=>j.id===i.id)));
});
const cases=[
 ['top','셔츠','맨투맨'],['top','셔츠','티셔츠'],['bottom','슬랙스','조거 팬츠'],
 ['bottom','슬랙스','카고 팬츠'],['shoe','펌프스','운동화'],['outer','블레이저','후드 집업']
];
for(const [category,oldType,newType] of cases)test('착용감 없이 종류로 '+oldType+' → '+newType+' 교체',()=>{
 const reference=base().map(i=>({...i,comfort:null,itemType:i.category===category?oldType:''})),old=reference.find(i=>i.category===category);
 const next=change(old,{comfort:null,itemType:newType});const result=adjust([...reference,next],reference);
 assert.equal(result.outfit.find(i=>i.category===category).id,next.id);assert.equal(result.comfortAdjustment.status,'provisional');
 assert.equal(result.comfortAdjustment.changedCategories.length,1);assert.ok(result.comfortAdjustment.change.reasons.length);
 assert.ok(result.outfit.every(i=>i.comfort===null));
});
test('착용감 미입력 3단계 반복: 하의·상의·겉옷, 신발 유지, 이전 코디로 순환하지 않음',()=>{
 const reference=base().map(i=>({...i,comfort:null,itemType:({top:'긴소매 티셔츠',bottom:'슬랙스',shoe:'스니커즈',outer:'카라 재킷'})[i.category]}));
 const pool=[...reference,...reference.filter(i=>i.category!=='shoe').map(i=>change(i,{comfort:null,fit:'여유핏',itemType:({top:'맨투맨',bottom:'조거 팬츠',outer:'후드 재킷'})[i.category]}))];
 let previous=reference,score=outfitComfort(previous).score;const changed=[];
 for(let n=0;n<3;n++){
  const result=adjust(pool,previous);changed.push(...result.comfortAdjustment.changedCategories);
  assert.equal(result.comfortAdjustment.status,'provisional');assert.ok(result.comfortAdjustment.metrics.score>score);
  assert.equal(result.outfit.find(i=>i.category==='shoe').id,'0-shoe');score=result.comfortAdjustment.metrics.score;previous=result.outfit;
 }
 assert.deepEqual(new Set(changed),new Set(['상의','하의','겉옷']));assert.equal(adjust(pool,previous).comfortAdjustment.status,'unchanged');
 assert.match(comfortAdjustmentMessage([],ctx,adjust(pool,previous)),/더 나은 대안이 없어/);
});
test('핏만 달라도 교체하며 선호하는 슬림핏이 활동성을 높인다고 가정하지 않는다',()=>{
 const reference=base().map(i=>({...i,comfort:null,fit:'슬림핏',itemType:'티셔츠'})),old=reference[0];
 const next=change(old,{comfort:null,fit:'여유핏'}),pool=[...reference,next];
 assert.equal(adjust(pool,reference).outfit[0].id,next.id);
 assert.ok(garmentComfort(next).score>garmentComfort(old).score);
});
test('동일 성격의 운동화 둘은 이름이나 색 때문에 더 편하다고 순환 교체하지 않는다',()=>{
 const reference=base().map(i=>({...i,comfort:null,itemType:i.category==='shoe'?'운동화':''})),shoe=reference.find(i=>i.category==='shoe');
 const next=change(shoe,{comfort:null,itemType:'운동화',color:'흰색',name:'다른 운동화'});
 assert.deepEqual(ids(adjust([...reference,next],reference).outfit),ids(reference));
});
test('종류가 없으면 옷 이름을 참고하고 색·광택·사이즈로 소재나 신축성을 만들어내지 않는다',()=>{
 assert.ok(garmentComfort({category:'top',name:'블랙 맨투맨'}).score>0);
 const item={category:'bottom',name:'내 옷',color:'검정',surface:'매끈함',officialSize:'M'};
 assert.equal(garmentComfort(item).basis,'unknown');assert.equal(garmentComfort(item).score,0);
});
