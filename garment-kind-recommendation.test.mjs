import test from 'node:test';
import assert from 'node:assert/strict';
import {recommend} from './engine.js';
import {garmentKind,garmentComfort,garmentKindHint} from './outfit-comfort.js';
import {analysisDraft} from './vision-format.js';
const profile={fit:'',moodPreferences:[]};
const ctx={formal:0,walking:0,text:'',exposure:'mixed',sensitivities:[]};
const weather={min:15,max:24};
const item=(id,category,name,itemType,extra={})=>({id,category,name,itemType,color:'검정',warmth:1,formal:0,comfort:null,fit:'',style:'',available:true,...extra});
const base=()=>[item('t','top','긴소매 티셔츠','티셔츠'),item('b','bottom','베이지 슬랙스','슬랙스'),item('s','shoe','운동화','운동화'),item('o','outer','얇은 패딩','후드 패딩 재킷')];
const adjust=(pool,reference,context=ctx,w=weather)=>recommend(pool,profile,context,w,{modifier:'comfort',referenceIds:reference.map(i=>i.id)});
test('블랙 진·블랙진·흑청·진·청바지는 검정색 자체를 사용하지 않고 데님 종류로 비교',()=>{
 for(const name of ['블랙 진','블랙진','흑청 팬츠','진','청바지'])assert.equal(garmentKind(item('x','bottom',name,'팬츠')).label,'데님·청바지 계열');
 assert.equal(garmentKind(item('x','bottom','블랙 팬츠','팬츠')).label,'일반 팬츠 계열');
 assert.equal(garmentKind(item('x','bottom','멋진 팬츠','팬츠')).label,'일반 팬츠 계열');
});
test('사용자 실제 등록명 두 개만으로 청바지나 방풍 기능을 만들어내지 않는다',()=>{
 const jeans=item('j','bottom','블랙 팬츠','팬츠');
 const jacket=item('w','outer','블랙 후드 긴소매 재킷','후드 긴소매 재킷');
 assert.equal(garmentKind(jeans).specific,false);assert.equal(garmentKind(jacket).specific,false);
 assert.match(garmentKindHint(jeans),/청바지/);assert.match(garmentKindHint(jacket),/패딩과 바람막이/);
 assert.equal(garmentKind({...jacket,surface:'매끈한 나일론'}).specific,false);
});
test('팬츠·재킷·후드 등 넓은 종류는 이름에 명시된 구체적 종류로 보완',()=>{
 assert.equal(garmentKind(item('x','outer','바람막이 아우터','재킷')).label,'바람막이 계열');
 assert.equal(garmentKind(item('x','outer','얇은 패딩','후드 긴소매 재킷')).label,'패딩 계열');
});
test('후드 패딩을 후드라는 이유만으로 바람막이와 같은 편안함 점수로 취급하지 않는다',()=>{
 const padding=item('p','outer','얇은 패딩','후드 패딩 재킷'),wind=item('w','outer','블랙 후드 긴소매 재킷','바람막이형 재킷');
 assert.equal(garmentKind(padding).label,'패딩 계열');assert.ok(garmentComfort(wind).score>garmentComfort(padding).score);
});
test('Gemini 구조화 결과의 구체적 세부 종류는 등록 초안과 추천까지 유지',()=>{
 const attrs={category:'하의',item_type:'청바지(데님 팬츠)',main_color:'블랙',pattern:'무지',surface_visual:'데님처럼 보이는 표면',silhouette_visual:'일자',length_visual:'긴바지'};
 const analysis={attributes:Object.fromEntries(Object.entries(attrs).map(([k,value])=>[k,{value,uncertainty:'추정'}]))};
 const draft=analysisDraft(analysis);const j={...item('j','bottom','블랙 팬츠','팬츠'),...draft,name:'블랙 팬츠'};
 const reference=base(),result=adjust([...reference,j],reference);
 assert.equal(result.outfit.find(i=>i.category==='bottom').id,'j');assert.equal(result.comfortAdjustment.status,'provisional');
});
test('실제 등록 이름을 유지하고 세부 종류가 확인된 대안 두 개를 한 종류씩 교체',()=>{
 const reference=base(),j=item('j','bottom','블랙 팬츠','청바지'),w=item('w','outer','블랙 후드 긴소매 재킷','바람막이형 재킷');
 const pool=[...reference,j,w],snapshot=structuredClone(pool);
 const first=adjust(pool,reference),second=adjust(pool,first.outfit),third=adjust(pool,second.outfit);
 for(const [a,b] of [[reference,first.outfit],[first.outfit,second.outfit]])assert.equal(b.filter(i=>!a.some(x=>x.id===i.id)).length,1);
 assert.ok(second.outfit.some(i=>i.id==='j'));assert.ok(second.outfit.some(i=>i.id==='w'));assert.equal(third.comfortAdjustment.status,'unchanged');
 assert.deepEqual(pool,snapshot);assert.ok(first.comfortAdjustment.alternatives.some(a=>a.eligible&&!a.selected));
});
test('부적합 보온과 보온 모름 때문에 제외된 바람막이에 각각 이유를 보여준다',()=>{
 const reference=base();
 for(const warmth of [0,null]){
  const w=item('w','outer','블랙 후드 긴소매 재킷','바람막이형 재킷',{warmth});
  const result=adjust([...reference,w],reference),detail=result.comfortAdjustment.alternatives.find(a=>a.id==='w');
  assert.equal(result.outfit.find(i=>i.category==='outer').id,'o');assert.equal(detail.eligible,false);assert.match(detail.reasons.join(' '),warmth===null?/모름/:/날씨/);
 }
});
test('면접의 격식 또는 직접 불편함 때문에 제외되는 청바지의 이유를 보여준다',()=>{
 const reference=base().map(i=>({...i,formal:2}));
 const j=item('j','bottom','블랙 팬츠','청바지',{formal:0});
 const formal=adjust([...reference,j],reference,{...ctx,formal:2});
 assert.match(formal.comfortAdjustment.alternatives.find(a=>a.id==='j').reasons.join(' '),/복장 조건/);
 const manual=adjust([...reference,{...j,formal:2,comfort:false}],reference);
 assert.equal(manual.outfit.find(i=>i.category==='bottom').id,'b');assert.match(manual.comfortAdjustment.alternatives[0].reasons.join(' '),/불편/);
});
test('구체적인 세부 종류와 이름이 충돌하면 임의로 덮지 않고 확인을 요청',()=>{
 const conflict=item('w','outer','바람막이','패딩 재킷');
 assert.equal(garmentKind(conflict).label,'패딩 계열');assert.match(garmentKindHint(conflict),/달라요/);
});
test('입을 수 없는 옷은 후보 진단에도 포함하지 않고 동일 후보를 중복하지 않는다',()=>{
 const reference=base(),pool=[...reference,item('j','bottom','블랙 팬츠','청바지'),item('w','outer','바람막이','바람막이',{available:false})];
 const result=adjust(pool,reference),rows=result.comfortAdjustment.alternatives;
 assert.deepEqual(rows.map(a=>a.id),['j']);
});
