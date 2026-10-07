import test from 'node:test';
import assert from 'node:assert/strict';
import {warmthOptions,warmthValue,displayColor,garmentSizing,sizeCaption} from './garment-fields.js';
import {colorFamily} from './vision-format.js';
import {recommend,contexts} from './engine.js';
import {sanitizeClientEvent} from './client-log.js';
test('five warmth choices retain old values and unknown stays unknown',()=>{
 assert.deepEqual(warmthOptions.slice(1).map(([v])=>warmthValue(v)),[0,.5,1,1.5,2]);
 for(const v of [0,1,2])assert.equal(warmthValue(v),v);
 assert.equal(warmthValue(''),null);assert.equal(warmthValue(null),null);assert.equal(warmthValue(4),null);
});
test('mixed colour accepts old analysis wording and new display wording',()=>{
 assert.equal(displayColor('다색'),'혼합');assert.equal(colorFamily('여러 색 / 멀티'),'혼합');assert.equal(colorFamily('혼합'),'혼합');assert.equal(colorFamily('다색'),'혼합');
});
test('shoe sizes are independent of clothing fit and retain international units',()=>{
 assert.deepEqual(garmentSizing('shoe',{fit:'기본 핏',officialSize:' 245 mm / EU 38 '}),{fit:'',officialSize:'245 mm / EU 38'});
 assert.deepEqual(garmentSizing('top',{fit:'기본 핏',officialSize:' M '}),{fit:'기본 핏',officialSize:'M'});
 assert.equal(sizeCaption({category:'shoe',fit:'기본 핏'}),'사이즈 미정');
});
test('intermediate warmth affects weather ranking; old shoe fit never earns a clothing fit bonus',()=>{
 const closet=[{id:'t0',category:'top',warmth:0},{id:'t5',category:'top',warmth:.5},{id:'b',category:'bottom',warmth:1},{id:'a',category:'shoe',fit:''},{id:'z',category:'shoe',fit:'기본 핏'}].map(i=>({...i,color:'검정',available:true,formal:0}));
 const profile={fit:'기본 핏'},result=recommend(closet,profile,contexts(profile,''),{min:22,max:24});
 assert.equal(result.outfit.find(i=>i.category==='top').id,'t5');assert.equal(result.outfit.find(i=>i.category==='shoe').id,'a');assert.ok(!result.reasons.some(r=>r.includes('핏으로 등록')));
});
test('future cutout display duration and actual analysis source can be safely logged',()=>{
 assert.deepEqual(sanitizeClientEvent({event:'cutout_ui_applied',details:{elapsedMs:2300,data:'private-image'}}).details,{elapsedMs:2300});
 assert.deepEqual(sanitizeClientEvent({event:'analysis_input_selected',details:{source:'original',hasCutout:true,name:'private name'}}).details,{source:'original',hasCutout:true});
});
