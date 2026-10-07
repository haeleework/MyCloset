import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisDraft,validateAnalysis,visionPrompt} from './vision-format.js';
import {visionRequestSchema} from './vision-request-schema.js';
import {createVisionService} from './wardrobe-vision.mjs';
import {thicknessMetadata,thicknessPreference,thicknessOptions} from './thickness-policy.js';
import {assessTemperature} from './recommendation-attributes.js';
import {createRuleRecommendations} from './recommendation-rules.js';
import {populateGarmentConfirmationFields,readGarmentConfirmationFields} from './frontend-garment-fields.js';
import {mergeAnalysisDraft} from './garment-fields.js';
import {recommendationWardrobe} from './frontend-recommendations.js';
import {createAppServer} from './app-server.mjs';
import {fileURLToPath} from 'node:url';
import {garmentMetadata} from './wardrobe-repository.mjs';
const field=(value,uncertainty='명확함')=>({value,uncertainty,evidence:value?'가장자리와 접힌 부분의 관찰 단서':'사진에서 확인 불가'});
const analysis=()=>({attributes:{category:field('상의'),item_type:field('스웨터'),main_color:field('검정'),pattern:field('무지'),surface_visual:field('니트 조직'),silhouette_visual:field('직선'),length_visual:field(null,'모름'),thickness_visual:field('thick','추정'),insulation_visual:field(null,'모름')},visible_details:[],uncertain_fields:['length_visual','thickness_visual','insulation_visual'],photo_quality:{usable_for_registration:'가능',lighting_note:'보통',occlusion_note:'안쪽 미노출'}});
const plan=t=>({known:true,low:t,high:t,baseTarget:2,outerTarget:2,outerNeeded:t<17});
const garment=(id,category,thickness)=>({id,name:id,category,itemType:category==='outer'?'재킷':'긴팔',color:'검정',formal:0,available:true,warmth:null,thickness,thicknessSource:'ai_estimate',thicknessEvidence:'사진 단서'});
test('current photo request includes five thickness levels and visible structure; legacy records remain readable',()=>{
 assert.ok(visionRequestSchema.properties.attributes.required.includes('thickness_visual'));
 assert.equal(visionRequestSchema.properties.attributes.properties.thickness_visual.properties.value.anyOf[0].enum.length,5);
 assert.match(visionPrompt,/최초|thickness_visual/);
 const old=analysis();delete old.attributes.thickness_visual;delete old.attributes.insulation_visual;
 assert.doesNotThrow(()=>validateAnalysis(old));assert.equal(analysisDraft(old).thickness,undefined);
});
test('photo analysis mock flows through form, saving and recommendation transport without confirming AI estimate',async()=>{
 let calls=0;
 const service=createVisionService({getKey:()=> 'mock-key',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(analysis())}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:50,totalTokenCount:60}}));}});
 const record=await service.analyze({mimeType:'image/jpeg',data:Buffer.from([255,216,255,224,0,1]).toString('base64')});
 assert.equal(calls,1);assert.equal(record.physicalAttributes.warmth,null);
 const form={elements:{thickness:{value:''}}};populateGarmentConfirmationFields(form,record.draft);
 const item={...garment('sweater','top'),...readGarmentConfirmationFields(form),...thicknessMetadata(form.elements.thickness.value,{analysis:record.analysis})};
 assert.equal(item.thickness,'thick');assert.equal(item.thicknessSource,'ai_estimate');
 const reloaded=JSON.parse(JSON.stringify(item));populateGarmentConfirmationFields(form,reloaded);
 assert.equal(form.elements.thickness.value,'thick');
 assert.equal(thicknessMetadata('thick',{analysis:record.analysis,previous:reloaded}).thicknessSource,'ai_estimate');
 const sent=recommendationWardrobe([{...item,photo:'data:image/jpeg;base64,private',vision:record}])[0];
 assert.equal(sent.thicknessSource,'ai_estimate');assert.equal(sent.photo,undefined);assert.equal(sent.vision,undefined);
});
test('invalid new analysis states fail validation rather than inventing measured thickness',()=>{
 for(const modify of [a=>a.attributes.thickness_visual.uncertainty='명확함',a=>a.attributes.thickness_visual.value='giant',a=>a.attributes.thickness_visual.evidence='',a=>delete a.attributes.insulation_visual]){const a=analysis();modify(a);assert.throws(()=>validateAnalysis(a));}
});
test('manual override and intentional clearing survive reanalysis, without mandatory confirmation',()=>{
 const next=analysisDraft(analysis());
 assert.equal(thicknessMetadata('thin',{analysis:analysis(),edited:true}).thicknessSource,'user');
 assert.equal(thicknessMetadata(null,{edited:true}).thicknessSource,'user');
 assert.equal(thicknessMetadata(null,{previous:{thickness:null,thicknessSource:'user'}}).thicknessSource,'user');
 const merged=mergeAnalysisDraft({thickness:'thin'},{thickness:'thin'},next,{editedFields:['thickness']});
 assert.equal(merged.values.thickness,'thin');
});
test('new evidence refreshes AI provenance; metadata transport retains it and removes private analysis',()=>{
 const fresh=analysis();fresh.attributes.thickness_visual.evidence='새 사진 소매 가장자리';
 const meta=thicknessMetadata('thick',{analysis:fresh,previous:{thickness:'thick',thicknessSource:'ai_estimate',thicknessEvidence:'이전 근거'}});
 assert.equal(meta.thicknessEvidence,'새 사진 소매 가장자리');
 const item={...garment('test','top','thick'),...meta,vision:fresh,photo:'private'};
 const row=garmentMetadata(item);assert.equal(row.thicknessSource,'ai_estimate');assert.equal(row.thicknessEvidence,meta.thicknessEvidence);assert.equal(row.vision,undefined);assert.equal(row.photo,undefined);
});
test('cold favours thicker same-role garments; heat favours thinner; no thickness creates no hard exclusion',()=>{
 for(const category of ['top','bottom','outer','dress']){
  assert.ok(thicknessPreference(garment('thick',category,'thick'),plan(8)).score>thicknessPreference(garment('thin',category,'thin'),plan(8)).score);
  assert.ok(thicknessPreference(garment('thin',category,'thin'),plan(28)).score>thicknessPreference(garment('thick',category,'thick'),plan(28)).score);
 }
 const unknown=garment('unknown','top',null);assert.equal(assessTemperature([unknown],plan(8)).excluded.length,0);
 assert.equal(thicknessPreference(unknown,plan(8)).basis,'unknown');
});
test('all temperature boundaries apply deterministic role targets',()=>{
 const targets=[[25,[0,1],[0,1]],[20,[1,2],[0,1]],[15,[1,2],[1,2]],[10,[2,3],[1,2]],[5,[3,4],[3,4]],[4.99,[3,4],[4,4]]];
 for(const [t,base,outer] of targets){assert.deepEqual(thicknessPreference(garment('top','top','medium'),plan(t)).target,base);assert.deepEqual(thicknessPreference(garment('outer','outer','medium'),plan(t)).target,outer);}
 assert.equal(thicknessOptions.length,5);
});
test('layers use warm activity temperature for base and cold activity temperature for outer',()=>{
 const p={...plan(12),low:8,high:24};
 assert.equal(thicknessPreference(garment('base','top','thin'),p).temperature,24);
 assert.equal(thicknessPreference(garment('outer','outer','thick'),p).temperature,8);
});
test('confirmed warmth supersedes thickness to avoid double counting',()=>{
 const a={...garment('top','top','thin'),warmth:2};const b={...a,thickness:'very_thick'};
 assert.equal(assessTemperature([a],plan(8)).score,assessTemperature([b],plan(8)).score);
});
test('visible insulation cue gives only one provisional step, and no hard exclusion by AI thickness',()=>{
 const thin=garment('padding','outer','thin');const padded={...thin,insulationVisual:'padding_structure',insulationSource:'ai_visual',insulationEvidence:'부피가 있는 겉 구조'};
 assert.equal(thicknessPreference(padded,plan(8)).score-thicknessPreference(thin,plan(8)).score,4);
 assert.equal(thicknessPreference({...padded,insulationEvidence:''},plan(8)).score,thicknessPreference(thin,plan(8)).score);
 const inferred={...garment('puffer','outer','very_thick'),itemType:'패딩'};
 assert.equal(assessTemperature([inferred],plan(28)).excluded.length,0);
});
test('full rules rank different thickness from same saved attributes without new photo analysis',()=>{
 const wardrobe=[garment('thin','top','thin'),garment('thick','top','thick'),garment('bottom','bottom','medium'),garment('shoe','shoe',null),garment('coat','outer','thick')];
 const before=JSON.stringify(wardrobe);
 const cold=createRuleRecommendations(wardrobe,{}, {},{min:8,max:8});
 const hot=createRuleRecommendations(wardrobe,{}, {},{min:28,max:28});
 assert.ok(cold.looks[0].itemIds.includes('thick'));assert.ok(hot.looks[0].itemIds.includes('thin'));
 assert.equal(JSON.stringify(wardrobe),before);
});
test('new browser dependency is served through real app server static allowlist',async t=>{
 const server=createAppServer({root:fileURLToPath(new URL('.',import.meta.url)),store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/thickness-policy.js`);assert.equal(response.status,200);assert.match(await response.text(),/thicknessPreference/);
});
