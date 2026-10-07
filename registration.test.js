import test from 'node:test';
import assert from 'node:assert/strict';
import {alternativeRegistration,recommend,contexts} from './engine.js';

function wardrobe(counts){return Object.entries(counts).flatMap(([category,quantity])=>Array.from({length:quantity},(_,i)=>({id:category+i,category,available:true,color:'검정',formal:1,warmth:1})));}

test('티셔츠 하나일 때 하의와 신발을 빠짐없이 안내하고 전체 등록 기준은 겉옷까지 계산한다',()=>{
 const closet=wardrobe({top:1});
 const result=recommend(closet,{},contexts({},''),null);
 assert.equal(result.outfit,null);
 assert.deepEqual(result.missing,['하의','신발']);
 assert.deepEqual(alternativeRegistration(closet).standard.needs,[{category:'top',quantity:1},{category:'bottom',quantity:2},{category:'shoe',quantity:1},{category:'outer',quantity:1}]);
});

test('신발 유무와 관계없이 첫 코디의 부족한 모든 종류를 확인한다',()=>{
 assert.deepEqual(recommend([],{},contexts({},''),null).missing,['상의','하의','신발']);
 assert.deepEqual(recommend(wardrobe({bottom:1}),{},contexts({},''),null).missing,['상의','신발']);
 assert.deepEqual(recommend(wardrobe({dress:1}),{},contexts({},''),null).missing,['신발']);
});

test('첫 코디는 한 세트로 시작하지만 다른 조합은 전체 등록 기준을 확인한다',()=>{
 const closet=wardrobe({top:1,bottom:1,shoe:1});
 assert.ok(recommend(closet,{},contexts({},''),null).outfit);
 const plan=alternativeRegistration(closet);
 assert.equal(plan.ready,false);
 assert.deepEqual(plan.minimumPlans[0].needs,[{category:'dress',quantity:1},{category:'outer',quantity:1}]);
 assert.deepEqual(plan.standard.needs,[{category:'top',quantity:1},{category:'bottom',quantity:1},{category:'outer',quantity:1}]);
});

test('상하의 두 개씩과 신발·겉옷 각각 하나는 모든 기준을 충족한다',()=>{
 assert.equal(alternativeRegistration(wardrobe({top:2,bottom:2,shoe:1,outer:1})).ready,true);
 assert.equal(alternativeRegistration(wardrobe({top:2,bottom:2,shoe:1})).ready,false);
});

test('원피스 하나는 상의 하나와 하의 하나를 각각 대체한다',()=>{
 assert.equal(alternativeRegistration(wardrobe({top:1,bottom:1,dress:1,shoe:1,outer:1})).ready,true);
 assert.equal(alternativeRegistration(wardrobe({dress:2,shoe:1,outer:1})).ready,true);
 const plan=alternativeRegistration(wardrobe({dress:1,shoe:1,outer:1}));
 assert.equal(plan.minimum,1);
 assert.deepEqual(plan.minimumPlans[0].needs,[{category:'dress',quantity:1}]);
});

test('상의가 많아도 부족한 하의를 대신하지 않으며 동수의 최소 경로를 제공한다',()=>{
 const plan=alternativeRegistration(wardrobe({top:5,bottom:1,shoe:1,outer:1}));
 assert.equal(plan.ready,false);assert.equal(plan.minimum,1);
 assert.deepEqual(plan.standard.needs,[{category:'bottom',quantity:1}]);
 assert.equal(plan.minimumPlans.length,2);
});

test('세탁 중인 옷과 구매 후보는 착용 가능한 보유 수량에 포함하지 않는다',()=>{
 const closet=wardrobe({top:2,bottom:2,shoe:1,outer:1});
 closet.find(i=>i.category==='outer').available=false;
 closet.push({id:'candidate',category:'outer',available:true,candidate:true});
 assert.deepEqual(alternativeRegistration(closet).standard.needs,[{category:'outer',quantity:1}]);
});

test('빈 옷장에는 원피스 경로와 상하의 경로를 각각 계산한다',()=>{
 const plan=alternativeRegistration([]);
 assert.equal(plan.minimum,4);assert.equal(plan.standard.total,6);
 assert.deepEqual(plan.minimumPlans[0].needs,[{category:'dress',quantity:2},{category:'shoe',quantity:1},{category:'outer',quantity:1}]);
});

test('종류별 수량 조합에서 제시한 최소 경로는 실제로 전체 기준을 충족한다',()=>{
 for(let top=0;top<4;top++)for(let bottom=0;bottom<4;bottom++)for(let dress=0;dress<3;dress++)for(let shoe=0;shoe<2;shoe++)for(let outer=0;outer<2;outer++){
  const closet=wardrobe({top,bottom,dress,shoe,outer}),plan=alternativeRegistration(closet);
  assert.equal(plan.ready,top+dress>=2&&bottom+dress>=2&&shoe>=1&&outer>=1);
  let expected=Infinity;
  for(let t=0;t<=2;t++)for(let b=0;b<=2;b++)for(let d=0;d<=2;d++)if(top+t+dress+d>=2&&bottom+b+dress+d>=2)expected=Math.min(expected,t+b+d+Number(shoe===0)+Number(outer===0));
  assert.equal(plan.minimum,expected);
  for(const path of plan.minimumPlans){
   const additional=wardrobe(Object.fromEntries(path.needs.map(n=>[n.category,n.quantity])));
   assert.equal(alternativeRegistration([...closet,...additional]).ready,true);
  }
 }
});

test('날씨 때문에 필요한 겉옷과 일정 격식에 필요한 종류를 안내한다',()=>{
 const closet=wardrobe({top:1,bottom:1,shoe:1}),profile={};
 const result=recommend(closet,profile,contexts(profile,'면접'),{min:3,max:8});
 assert.ok(result.notices.some(text=>text.includes('가지고 계신 겉옷을 추가해주세요')));
 assert.ok(result.notices.some(text=>text.includes('상의 1개·하의 1개')));
});
