import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudWardrobeController,cloudWardrobeMetadata,mergeCloudWardrobe,renderCloudWardrobePanel} from './frontend-storage.js';
import {garmentMetadata} from './wardrobe-repository.mjs';

const config={url:'https://synthetic-project.supabase.co',publishableKey:'sb_publishable_synthetic'};
const userId='00000000-0000-4000-8000-000000000001';
const garment={id:'synthetic-top',category:'top',name:'가상 상의',color:'흰색',warmth:null,available:true};
const reply=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function harness(options={}) {
  const calls=[],states=[];
  const fetchImpl=async(url,init={})=>{
    calls.push({url,init});
    const custom=await options.respond?.(url,init);
    if(custom)return custom;
    if(url.endsWith('/token?grant_type=password'))return reply({access_token:'synthetic-access-token',expires_in:3600});
    if(url.endsWith('/auth/v1/user'))return reply({id:userId,is_anonymous:false});
    if(url.endsWith('/logout?scope=local'))return reply(null,204);
    if(url==='/api/config')return reply({supabase:{enabled:true,url:config.url}});
    if(url==='/api/wardrobe')return reply({user:{id:userId},wardrobe:init.body?JSON.parse(init.body).wardrobe:[garment]});
    throw new Error('Unexpected network target');
  };
  const controller=createCloudWardrobeController({fetchImpl,onState:s=>states.push(s),...options});
  return {controller,calls,states};
}
async function signIn(controller) {controller.configure(config);await controller.login({email:'synthetic@example.invalid',password:'synthetic-password'});}

test('metadata shares server fields, keeps unknown values and excludes all photos/private attributes',()=>{
  const original={...garment,photo:new Blob(['private photo']),cutout:{photo:'private'},vision:{secret:'analysis'},capture:{raw:'private'},url:'https://private.invalid',apiKey:'private',user_id:'other',colorDescription:'not server field',styleTags:['가상'],materialConfirmed:false};
  const data=cloudWardrobeMetadata([original]);
  assert.deepEqual(data,[garmentMetadata(original)]);
  assert.equal(original.photo.size,13);
  assert.equal(data[0].warmth,null);
  assert.doesNotMatch(JSON.stringify(data),/private|photo|cutout|vision|capture|apiKey|user_id/);
  assert.deepEqual(cloudWardrobeMetadata([{...garment,name:'data:image/png;base64,sensitive'}]),[{id:garment.id,category:'top',color:'흰색',warmth:null,available:true}]);
  assert.throws(()=>cloudWardrobeMetadata([garment,garment]),{code:'INVALID_WARDROBE'});
});

test('explicit import adds missing IDs while preserving local edits and photo objects',()=>{
  const photo=new Blob(['original']),local=[{...garment,name:'기기에서 수정한 이름',photo}];
  const merged=mergeCloudWardrobe(local,[{...garment,name:'원격 이름'},{id:'new-bottom',category:'bottom',name:'가상 하의',photo:'private'}]);
  assert.equal(merged.addedCount,1);assert.equal(merged.keptLocalCount,1);
  assert.equal(merged.wardrobe[0],local[0]);assert.equal(merged.wardrobe[0].photo,photo);
  assert.equal(merged.wardrobe[0].name,'기기에서 수정한 이름');
  assert.equal(merged.wardrobe[1].photo,undefined);
  assert.equal(local.length,1);
});

test('construction/configuration make no requests and reject nonpublic credentials and unsafe URLs',()=>{
  const {controller,calls}=harness();assert.equal(calls.length,0);
  for(const bad of [{...config,url:'http://synthetic-project.supabase.co'},{...config,url:config.url+'/path'},{...config,url:'https://user:password@synthetic-project.supabase.co'}, {...config,publishableKey:'sb_secret_private'}, {...config,publishableKey:'not-a-public-key'}])assert.throws(()=>controller.configure(bad),{code:'INVALID_CONFIG'});
  controller.configure(config);assert.equal(calls.length,0);
  assert.equal(controller.getState().configured,true);
  assert.doesNotMatch(JSON.stringify(controller.getState()),/sb_publishable/);
});

test('login verifies user, keeps session in memory, and does not auto-sync',async()=>{
  const {controller,calls,states}=harness();await signIn(controller);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,config.url+'/auth/v1/token?grant_type=password');
  assert.deepEqual(JSON.parse(calls[0].init.body),{email:'synthetic@example.invalid',password:'synthetic-password'});
  assert.equal(calls[1].init.headers.Authorization,'Bearer synthetic-access-token');
  assert.equal(controller.getState().signedIn,true);
  assert.equal(controller.getState().userId,userId);
  assert.equal(controller.getAccessToken(),null,'A server target check is required before exposing a recommendation token');
  assert.doesNotMatch(JSON.stringify(states),/synthetic-password|synthetic-access-token|sb_publishable/);
});

test('upload requires explicit consent and posts only metadata after confirming server target',async()=>{
  const {controller,calls}=harness();await signIn(controller);
  await assert.rejects(controller.upload([garment]),{code:'EXPLICIT_UPLOAD_REQUIRED'});
  assert.equal(calls.length,2);
  const local=[{...garment,photo:new Blob(['local image']),vision:{private:'data'}}];
  const result=await controller.upload(local,{confirmUpload:true});
  assert.equal(calls[2].url,'/api/config');
  assert.equal(calls[3].url,'/api/wardrobe');
  assert.equal(calls[3].init.method,'POST');
  assert.deepEqual(JSON.parse(calls[3].init.body),{confirmUpload:true,wardrobe:[garment]});
  assert.equal(calls[3].init.headers.Authorization,'Bearer synthetic-access-token');
  assert.deepEqual(result,[garment]);assert.ok(local[0].photo instanceof Blob);
  assert.equal(controller.getState().status,'synced');assert.deepEqual(controller.getState().linkedIds,[garment.id]);
  assert.equal(controller.getAccessToken(),'synthetic-access-token');
});

test('missing or mismatching app server target blocks wardrobe requests without forwarding the token',async()=>{
  for(const settings of [{},{supabase:{enabled:false,url:config.url}},{supabase:{enabled:true,url:'https://other.supabase.co'}}]){
    const {controller,calls}=harness({respond:url=>url==='/api/config'?reply(settings):null});
    await signIn(controller);
    await assert.rejects(controller.upload([garment],{confirmUpload:true}),{code:'SERVER_TARGET_MISMATCH'});
    assert.equal(calls.filter(c=>c.url==='/api/wardrobe').length,0);
    assert.equal(calls.at(-1).init.headers,undefined);
    assert.equal(controller.getAccessToken(),null);
  }
});

test('load returns metadata without applying any local changes and checks account ownership',async()=>{
  const {controller}=harness();await signIn(controller);
  assert.deepEqual(await controller.load(),[garment]);
  assert.equal(controller.getState().status,'loaded');
  const mismatch=harness({respond:url=>url==='/api/wardrobe'?reply({user:{id:'other-account'},wardrobe:[garment]}):null});
  await signIn(mismatch.controller);
  await assert.rejects(mismatch.controller.load(),{code:'ACCOUNT_MISMATCH'});
  assert.equal(mismatch.controller.getState().cloudCount,null);
});

test('partial or unexpected upload acknowledgements never report sync completion',async()=>{
  for(const wardrobe of [[],[{...garment,id:'unexpected'}],[garment,garment]]){
    const {controller}=harness({respond:url=>url==='/api/wardrobe'?reply({user:{id:userId},wardrobe}):null});
    await signIn(controller);
    await assert.rejects(controller.upload([garment],{confirmUpload:true}),{code:'INVALID_RESPONSE'});
    assert.equal(controller.getState().lastSyncAt,null);
  }
});

test('demo mode blocks configuration/login/upload/load and masks recommendation token',async()=>{
  let demo=false;
  const {controller,calls}=harness({isDemo:()=>demo});await signIn(controller);await controller.load();
  const previous=calls.length;demo=true;
  assert.throws(()=>controller.configure(config),{code:'DEMO_BLOCKED'});
  await assert.rejects(controller.login({email:'x',password:'x'}),{code:'DEMO_BLOCKED'});
  await assert.rejects(controller.load(),{code:'DEMO_BLOCKED'});
  await assert.rejects(controller.upload([garment],{confirmUpload:true}),{code:'DEMO_BLOCKED'});
  assert.equal(controller.getAccessToken(),null);assert.equal(calls.length,previous);
});

test('expired session and unauthorized server responses clear account state',async()=>{
  let clock=0;
  const {controller,calls}=harness({now:()=>clock});await signIn(controller);await controller.load();
  clock=3600001;assert.equal(controller.getAccessToken(),null);assert.equal(controller.getState().signedIn,false);
  const previous=calls.length;await assert.rejects(controller.load(),{code:'AUTH_REQUIRED'});assert.equal(calls.length,previous);
  const unauthorized=harness({respond:url=>url==='/api/wardrobe'?reply({code:'AUTH_REQUIRED'},401):null});
  await signIn(unauthorized.controller);await assert.rejects(unauthorized.controller.load(),{code:'AUTH_REQUIRED'});
  assert.equal(unauthorized.controller.getState().signedIn,false);
});

test('cancel prevents a delayed login from restoring signed-in state',async()=>{
  let release;
  const {controller}=harness({respond:url=>url.endsWith('/token?grant_type=password')?new Promise(resolve=>{release=()=>resolve(reply({access_token:'late-token',expires_in:3600}));}):null});
  controller.configure(config);const pending=controller.login({email:'x',password:'x'});
  controller.cancel();release();
  await assert.rejects(pending,{code:'CANCELLED'});
  assert.equal(controller.getState().signedIn,false);assert.equal(controller.getState().busy,false);
});

test('timeouts ignore late transport success and never expose credentials in errors',async()=>{
  let release;
  const {controller}=harness({timeoutMs:10,respond:url=>url.endsWith('/token?grant_type=password')?new Promise(resolve=>{release=()=>resolve(reply({access_token:'late-token',expires_in:3600}));}):null});
  controller.configure(config);
  await assert.rejects(controller.login({email:'x',password:'secret'}),{code:'TIMEOUT'});
  release();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(controller.getState().signedIn,false);assert.equal(controller.getState().busy,false);
  const leaking=harness({fetchImpl:async()=>{throw Object.assign(new Error('secret password'),{code:'AUTH_FAILED'});}});
  leaking.controller.configure(config);await assert.rejects(leaking.controller.login({email:'x',password:'secret'}));
  assert.doesNotMatch(leaking.controller.getState().error,/secret/);
});

test('logout clears session immediately and requests only current remote session logout',async()=>{
  const {controller,calls}=harness();await signIn(controller);await controller.load();
  const pending=controller.logout();assert.equal(controller.getState().signedIn,false);
  assert.equal(controller.getAccessToken(),null);await pending;
  assert.equal(calls.at(-1).url,config.url+'/auth/v1/logout?scope=local');
  assert.equal(calls.at(-1).init.method,'POST');
  assert.equal(controller.getState().status,'local');
});

test('panel escapes remote values and disables cloud controls in demo mode',()=>{
  const html=renderCloudWardrobePanel({configured:true,signedIn:true,demo:true,userId:'<img src=x onerror=alert(1)>',error:'<script>secret</script>',projectUrl:'" autofocus onfocus="bad',cloudCount:0});
  assert.doesNotMatch(html,/<img|<script|value="" autofocus/);
  assert.match(html,/&lt;img/);assert.match(html,/data-cloud-action="upload" disabled/);
  assert.match(html,/체험 옷장은 클라우드에 연결하지 않아요/);assert.match(html,/확인한 옷: 0개/);
  assert.match(html,/사진과 분석 원문은 전송하지 않으며/);
});
