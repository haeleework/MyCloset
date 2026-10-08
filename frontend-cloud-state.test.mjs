import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeCloudState,decodeCloudState,snapshotMedia,uploadCloudPhoto} from './frontend-cloud-state.js';
import {createCloudWardrobeController,renderCloudWardrobePanel} from './frontend-storage.js';
const uid='00000000-0000-4000-8000-000000000001';
const config={url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'};
const json=(x,status=200)=>new Response(status===204?null:JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const local=()=>({closet:[{id:'fixture',name:'가상 블랙 진',category:'bottom',color:'검정',warmth:null,comfort:false,material:'',photo:new Blob(['synthetic'],{type:'image/png'}),capture:{hasZone:false,gps:{latitude:1}},vision:{model:'fixture',analysis:{attributes:{thickness_visual:{value:'thin'}}},userReview:{values:{material:''}}}}],profile:{walking:0,cooling:false},locationIds:[],onboarding:{completedAt:null},schedule:{date:'2026-10-08',text:''},history:[{date:'2026-10-08',ids:['fixture'],names:['가상 블랙 진']}],feedback:[{date:'2026-10-08',ids:['fixture'],feeling:'ok',season:'mild',wore:true}],answers:[],confirmedGroups:[]});
function snapshot(payload,revision=1){return {userId:uid,revision,garments:payload.closet.map(g=>({user_id:uid,id:g.id,attributes:g.attributes})),details:payload.closet.map(g=>({user_id:uid,garment_id:g.id,display_metadata:g.display,capture_metadata:g.capture,review_state:{media:g.media}})),analyses:payload.closet.filter(g=>g.vision).map(g=>({user_id:uid,garment_id:g.id,analysis:g.vision})),media:payload.closet.flatMap(g=>g.media.map(m=>({...m,user_id:uid,garment_id:g.id,status:'pending'}))),preferences:{user_id:uid,profile:payload.profile,location_ids:payload.locationIds,onboarding:payload.onboarding},contexts:[{user_id:uid,context:payload.schedule}],history:payload.history.map(h=>({user_id:uid,snapshot:h})),feedback:payload.feedback.map(f=>({user_id:uid,local_date:f.date,item_ids:f.ids,feeling:f.feeling,season:f.season,wore:f.wore})),legacy:{user_id:uid,answers:payload.answers,confirmed_groups:payload.confirmedGroups}};}
test('whole state roundtrip preserves photos, unknown values and review; excludes GPS and credentials',async()=>{
 const state=local();state.closet[0].vision.apiKey='SECRET';
 const {payload,photos}=await encodeCloudState(state,uid);assert.doesNotMatch(JSON.stringify(payload),/SECRET|latitude|gps|synthetic/);
 const saved=snapshot(payload);saved.media.forEach(m=>m.status='ready');
 const restored=await decodeCloudState(saved,uid,async m=>photos.get(m.object_path));
 assert.equal(await restored.closet[0].photo.text(),'synthetic');assert.equal(restored.closet[0].warmth,null);assert.equal(restored.closet[0].comfort,false);assert.equal(restored.closet[0].material,'');
 assert.deepEqual(restored.profile,state.profile);assert.deepEqual(restored.locationIds,[]);assert.deepEqual(restored.history,state.history);assert.deepEqual(restored.feedback,state.feedback);
 assert.equal(restored.closet[0].vision.userReview.values.material,'');assert.equal(restored.closet[0].capture.gps,undefined);
});
test('pending, foreign and damaged photos never produce a partial restored state',async()=>{
 const {payload}=await encodeCloudState(local(),uid);const data=snapshot(payload);let reads=0;
 await assert.rejects(decodeCloudState(data,uid,()=>reads++),{code:'MEDIA_INCOMPLETE'});assert.equal(reads,0);
 data.media[0].status='ready';await assert.rejects(decodeCloudState(data,uid,()=>new Blob(['corrupt'])),{code:'PHOTO_INTEGRITY'});
 data.media[0].object_path='foreign/path';assert.throws(()=>snapshotMedia(data),{code:'INVALID_RESPONSE'});
});
test('oversized fields and invalid images fail before any upload',async()=>{
 const state=local();state.closet[0].name='x'.repeat(201);await assert.rejects(encodeCloudState(state,uid),{code:'INVALID_STATE'});
 state.closet[0].name='가상';state.closet[0].photo=new Blob(['x'],{type:'text/html'});await assert.rejects(encodeCloudState(state,uid),{code:'INVALID_PHOTO'});
});
test('same photo retry verifies existing bytes without overwriting Storage',async()=>{
 const {payload,photos}=await encodeCloudState(local(),uid),m=payload.closet[0].media[0];let calls=0;
 await uploadCloudPhoto({url:config.url,key:config.publishableKey,token:'fixture',media:m,blob:photos.get(m.object_path),fetchImpl:async(url,init)=>{calls++;assert.equal(init.method,undefined);assert.match(url,/object\/authenticated/);return new Response(photos.get(m.object_path));}});assert.equal(calls,1);
});
test('large photo TUS location cannot exfiltrate authorization',async()=>{
 const state=local();state.closet[0].photo=new Blob([new Uint8Array(6*1024*1024+1)],{type:'image/png'});const {payload,photos}=await encodeCloudState(state,uid),m=payload.closet[0].media[0];let calls=0;
 await assert.rejects(uploadCloudPhoto({url:config.url,key:config.publishableKey,token:'fixture',media:m,blob:photos.get(m.object_path),fetchImpl:async(url,init)=>{calls++;if(!init.method)return new Response('',{status:404});return new Response('',{status:201,headers:{location:'https://other.invalid/storage/v1/upload/resumable/x'}});}}),{code:'PHOTO_UPLOAD_FAILED'});assert.equal(calls,2);
});
function cloudHarness({existing=0,failPhoto=false,conflict=false}={}){
 let current=null;const calls=[];const blobs=new Map();const controller=createCloudWardrobeController({fetchImpl:async(url,init={})=>{
  calls.push({url,init});
  if(url.endsWith('grant_type=password'))return json({access_token:'fixture-token',expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return json({id:uid});
  if(url==='/api/config')return json({supabase:{enabled:true,url:config.url}});
  if(url.endsWith('/closet_load_state'))return json(current||{userId:uid,revision:existing,garments:[],details:[],analyses:[],media:[],contexts:[],history:[],feedback:[]});
  if(url.endsWith('/closet_save_state')){if(conflict)return json({code:'PT409'},409);current=snapshot(JSON.parse(init.body).p_state);return json(current);}
  if(url.includes('/storage/v1/object/authenticated/')){const p=url.split('/closet-media/')[1];return blobs.has(p)?new Response(blobs.get(p)):new Response('',{status:404});}
  if(url.includes('/storage/v1/object/')){if(failPhoto)return new Response('',{status:500});blobs.set(url.split('/closet-media/')[1],init.body);return json({});}
  if(url.endsWith('/closet_finish_media')){current.media.find(m=>m.object_path===JSON.parse(init.body).p_path).status='ready';return new Response(null,{status:204});}
  throw Error('Unexpected call');
 }});return {controller,calls};
}
async function login(controller){controller.configure(config);await controller.login({email:'fixture@example.invalid',password:'fixture-password'});}
test('explicit full save followed by restore uses private photos and complete state',async()=>{
 const {controller,calls}=cloudHarness();await login(controller);await assert.rejects(controller.saveState(local()),{code:'EXPLICIT_UPLOAD_REQUIRED'});
 await controller.saveState(local(),{confirmUpload:true});assert.equal(controller.getState().status,'full-synced');const result=await controller.restoreState();assert.equal(await result.closet[0].photo.text(),'synthetic');assert.equal(result.profile.walking,0);
 assert(!calls.some(c=>/gemini|generativelanguage/.test(c.url)));assert(!calls.some(c=>c.url==='/api/wardrobe'));
});
test('remote existing state requires explicit inspection, stale revision cannot save',async()=>{
 const h=cloudHarness({existing:2,conflict:true});await login(h.controller);
 await assert.rejects(h.controller.saveState(local(),{confirmUpload:true}),{code:'CLOUD_REVIEW_REQUIRED'});
 assert(!h.calls.some(c=>c.url.endsWith('/closet_save_state')));await h.controller.inspect();await assert.rejects(h.controller.saveState(local(),{confirmUpload:true}),{code:'REVISION_CONFLICT'});
 assert(!h.calls.some(c=>c.url.includes('/storage/')));
});
test('photo failure never reports full sync success or last successful time',async()=>{
 const h=cloudHarness({failPhoto:true});await login(h.controller);await assert.rejects(h.controller.saveState(local(),{confirmUpload:true}),{code:'PHOTO_UPLOAD_FAILED'});
 assert.equal(h.controller.getState().status,'error');assert.equal(h.controller.getState().lastSyncAt,null);assert(!h.calls.some(c=>c.url.endsWith('/closet_finish_media')));
});
test('demo identity reconnects without email signup or exposing tokens in panel state',async()=>{
 const saved=new Map(),store={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};let signups=0;
 const fetchImpl=async(url,init)=>{
  if(url==='/api/config')return json({supabase:{enabled:true,url:config.url}});
  if(url.endsWith('/signup')){signups++;assert.equal(init.body,'{}');return json({access_token:'demo-token',refresh_token:'demo-refresh',expires_in:3600,user:{id:uid}});}
  if(url.endsWith('/auth/v1/user'))return json({id:uid,is_anonymous:true});
  throw Error('Unexpected call');
 };
 for(let i=0;i<2;i++){const c=createCloudWardrobeController({fetchImpl,demoSessionStore:store});c.configure({...config,authMode:'demo'});await c.connectDemo();assert.equal(c.getState().signedIn,true);assert.equal(c.getState().authMode,'demo');assert.doesNotMatch(JSON.stringify(c.getState()),/demo-token|demo-refresh/);const panel=renderCloudWardrobePanel(c.getState());assert.doesNotMatch(panel,/data-cloud-form="login"|>회원가입</);assert.match(panel,/이 브라우저의 전용 저장 공간/);}
 assert.equal(signups,1);assert.equal(saved.size,1);
});
test('disabled demo identity displays preparation error and never sends email or password',async()=>{
 const c=createCloudWardrobeController({demoSessionStore:{getItem:()=>null,setItem:()=>{}},fetchImpl:async(url,init)=>{
  if(url==='/api/config')return json({supabase:{enabled:true,url:config.url}});
  assert.equal(init.body,'{}');return json({error_code:'anonymous_provider_disabled'},422);
 }});c.configure({...config,authMode:'demo'});await assert.rejects(c.connectDemo(),{code:'DEMO_IDENTITY_DISABLED'});assert.equal(c.getState().signedIn,false);
});
test('demo session refresh preserves the same identity when expired',async()=>{
 const stored={accessToken:'expired-token',refreshToken:'refresh-before',userId:uid,expiresAt:1};let persisted;
 const c=createCloudWardrobeController({now:()=>100000,demoSessionStore:{getItem:()=>JSON.stringify(stored),setItem:(k,v)=>persisted=JSON.parse(v)},fetchImpl:async(url,init)=>{
  if(url==='/api/config')return json({supabase:{enabled:true,url:config.url}});
  if(url.endsWith('grant_type=refresh_token')){assert.equal(JSON.parse(init.body).refresh_token,'refresh-before');return json({access_token:'new-token',refresh_token:'new-refresh',expires_in:3600});}
  if(url.endsWith('/auth/v1/user'))return json({id:uid,is_anonymous:true});throw Error('Unexpected call');
 }});c.configure({...config,authMode:'demo'});await c.connectDemo();assert.equal(persisted.userId,uid);assert.equal(persisted.refreshToken,'new-refresh');
});

test('failed persistent identity storage cannot leave a usable hidden session',async()=>{
 const c=createCloudWardrobeController({demoSessionStore:{getItem:()=>null,setItem:()=>{throw Error('quota');}},fetchImpl:async(url)=>{
  if(url==='/api/config')return json({supabase:{enabled:true,url:config.url}});
  if(url.endsWith('/signup'))return json({access_token:'demo-token',refresh_token:'demo-refresh',expires_in:3600,user:{id:uid}});
  if(url.endsWith('/auth/v1/user'))return json({id:uid,is_anonymous:true});throw Error('Unexpected call');
 }});c.configure({...config,authMode:'demo'});await assert.rejects(c.connectDemo(),{code:'DEMO_SESSION_STORAGE'});
 assert.equal(c.getAccessToken(),null);assert.equal(c.getState().signedIn,false);
});
