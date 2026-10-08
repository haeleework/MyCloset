// Explicit integration check. Creates disposable anonymous identities and synthetic images only.
// Run with CLOSET_LIVE_STORAGE_CHECK=1; never included in npm test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {createCloudWardrobeController} from '../frontend-storage.js';
import {photoDigest} from '../frontend-cloud-state.js';
if(process.env.CLOSET_LIVE_STORAGE_CHECK!=='1')throw Error('Explicit live storage test opt-in required');
const base=process.env.CLOSET_CHECK_URL||'http://127.0.0.1:4336';
const config=await fetch(base+'/api/config').then(r=>r.json());
assert.equal(config.geminiEnabled,false);
assert.equal(config.supabase.enabled,true);
const {url,publishableKey}=config.supabase;
const ids=[],checks=[],stores=[];
const check=(name)=>{checks.push(name);console.log('PASS '+name);};
const identities=[];
function client(store=new Map()){
 stores.push(store);
 return createCloudWardrobeController({timeoutMs:30000,demoSessionStore:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},fetchImpl:async(target,options={})=>{
  const res=await fetch(target.startsWith('/')?base+target:target,options);
  if(!res.ok){const clone=res.clone();let d;try{d=await clone.json();}catch{}console.log('HTTP failure',res.status,new URL(target,base).pathname,d?.code||d?.error_code||d?.error||'');}
  return res;
 }});
}
const a=client(),b=client();
for(const c of [a,b]){c.configure({...config.supabase});await c.connectDemo();ids.push(c.getState().userId);identities.push(c);}
await fs.writeFile(new URL('./live-test-identities.json',import.meta.url),JSON.stringify({ids,createdAt:new Date().toISOString()}));
check('two independent demo identities connect without email or password');
const small=new Blob([await sharp({create:{width:48,height:48,channels:3,background:'#222222'}}).png().toBuffer()],{type:'image/png'});
const large=new Blob([await sharp(randomBytes(1600*1600*3),{raw:{width:1600,height:1600,channels:3}}).png().toBuffer()],{type:'image/png'});
assert(large.size>6*1024*1024&&large.size<20*1024*1024);
const state={closet:[{id:'synthetic-small',name:'저장 검증용 가상 블랙 팬츠',category:'bottom',color:'검정',warmth:null,comfort:false,material:'',available:true,photo:small,cutout:{photo:small,model:'synthetic'},vision:{model:'synthetic',analysis:{attributes:{}},userReview:{values:{material:''}}}},{id:'synthetic-large',name:'큰 사진 전송 검증용 가상 셔츠',category:'top',color:'흰색',photo:large}],profile:{walking:0,cooling:false},locationIds:[],onboarding:{completedAt:null},schedule:{date:'2026-10-08',text:'가상 저장 검증'},history:[{date:'2026-10-08',ids:['synthetic-small'],names:['저장 검증용 가상 블랙 팬츠']}],feedback:[{date:'2026-10-08',ids:['synthetic-small'],feeling:'ok',season:'mild',wore:true}],answers:[],confirmedGroups:[]};
try{
 await a.saveState(state,{confirmUpload:true});check('full state and small/large private photos saved');
 const restored=await a.restoreState();assert.equal(restored.closet.length,2);assert.equal(restored.profile.walking,0);assert.equal(restored.profile.cooling,false);
 for(const garment of state.closet){const actual=restored.closet.find(g=>g.id===garment.id);assert.equal(await photoDigest(actual.photo),await photoDigest(garment.photo));}
 assert.equal(await photoDigest(restored.closet.find(g=>g.id==='synthetic-small').cutout.photo),await photoDigest(small));
 assert.deepEqual(restored.history,state.history);assert.deepEqual(restored.feedback,state.feedback);check('roundtrip preserves image hashes, cutout, history, feedback and unknown values');
 await a.saveState(state,{confirmUpload:true});check('repeat save reuses identical uploaded photos');
 const c=client(stores[0]);c.configure(config.supabase);await c.connectDemo();assert.equal(c.getState().userId,ids[0]);await c.inspect();
 await a.saveState(state,{confirmUpload:true});await assert.rejects(c.saveState(state,{confirmUpload:true}),{code:'REVISION_CONFLICT'});check('reconnect retains identity and stale writer cannot overwrite');
 const other=await b.inspect();assert.equal(other.count,0);check('second identity has an empty isolated wardrobe');
 const tokenA=a.getAccessToken(),tokenB=b.getAccessToken();const headers=t=>({apikey:publishableKey,Authorization:'Bearer '+t});
 const rows=await fetch(url+'/rest/v1/wardrobe_garments?select=id&user_id=eq.'+ids[0],{headers:headers(tokenB)}).then(r=>r.json());assert.deepEqual(rows,[]);
 const media=await fetch(url+'/rest/v1/garment_media?select=object_path',{headers:headers(tokenA)}).then(r=>r.json());assert(media.length>=3);
 const denied=await fetch(url+'/storage/v1/object/authenticated/closet-media/'+media[0].object_path,{headers:headers(tokenB)});assert(!denied.ok);
 const unauth=await fetch(url+'/rest/v1/rpc/closet_load_state',{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:'{}'});assert(!unauth.ok);check('foreign rows/photos and unauthenticated RPC access denied');
 const recommendations=await fetch(base+'/api/recommendations',{method:'POST',headers:{...headers(tokenA),Origin:base,'Content-Type':'application/json'},body:JSON.stringify({requestId:'storage-live-check',wardrobeRevision:'live-test',wardrobe:[],profile:{},context:{},options:{}})});
 assert.equal(recommendations.status,200);const rec=await recommendations.json();assert.equal(rec.diagnostics.gemini.called,false);check('recommendation API succeeds without Gemini calls');
}finally{
 // Remove only objects owned by these test identities, using the Storage API.
 for(const c of identities){const token=c.getAccessToken();if(!token)continue;const headers={apikey:publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const rows=await fetch(url+'/rest/v1/garment_media?select=object_path',{headers}).then(r=>r.json());
  if(Array.isArray(rows)&&rows.length){const r=await fetch(url+'/storage/v1/object/closet-media',{method:'DELETE',headers,body:JSON.stringify({prefixes:rows.map(m=>m.object_path)})});assert(r.ok,'Synthetic storage cleanup failed');}
  await c.logout();
 }
 await fs.writeFile(new URL('./live-verification.json',import.meta.url),JSON.stringify({checks,passed:checks.length,ids,geminiCalls:0,completed:checks.length===8,at:new Date().toISOString()},null,2));
}
