// Cloud writes are opt-in. Secrets remain in memory; photo transfers use private Storage.
import {encodeCloudState,decodeCloudState,checkCloudSnapshot,snapshotMedia,uploadCloudPhoto} from './frontend-cloud-state.js';
// Auth endpoints follow Supabase auth-js; ownership is verified again by the server.
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
export const fields = ['name','category','color','fit','officialSize','style','warmth','formal','comfort','available','officialColor','itemType','itemTypeSource','material','materialConfirmed','thickness','thicknessSource','thicknessEvidence','insulationVisual','insulationSource','insulationEvidence','length','colorFamily','colorLightness','colorChroma','colorHue','styleTags','moods','garmentKind','garmentKindConfirmed'];
const categories = new Set(['top','bottom','dress','shoe','outer']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const errors = {
  DEMO_IDENTITY_DISABLED:'데모 자동 연결을 준비 중이에요. Supabase의 익명 로그인 설정이 필요합니다.',
  DEMO_SESSION_STORAGE:'이 브라우저에 데모 연결 정보를 보관하지 못했어요. 브라우저 저장 설정을 확인해주세요.',
  CLOUD_EMPTY:'이 계정에는 아직 저장된 옷장이 없어요. 현재 기기에서 전체 저장을 먼저 실행해주세요.',
  INVALID_STATE:'저장할 자료의 형식이나 길이를 확인해주세요. 기존 자료는 유지합니다.',
  STATE_TOO_LARGE:'옷장 정보가 한 번에 저장할 수 있는 크기를 넘었어요. 기존 자료는 유지합니다.',
  INVALID_PHOTO:'사진 형식과 크기를 확인해주세요. JPEG/PNG/WebP/HEIC/HEIF, 20MiB 이하를 지원합니다.',
  REVISION_CONFLICT:'다른 기기에서 저장한 변경이 있어요. 클라우드 상태를 다시 확인한 뒤 저장해주세요.',
  CLOUD_REVIEW_REQUIRED:'계정에 기존 자료가 있어요. 먼저 클라우드 상태 확인 또는 가져오기를 선택해주세요.',
  MEDIA_INCOMPLETE:'사진 저장이 아직 끝나지 않았어요. 원래 기기에서 전체 저장을 다시 실행해주세요.',
  PHOTO_INTEGRITY:'저장된 사진을 확인하지 못했어요. 기존 기기 자료를 유지합니다.',
  PHOTO_UPLOAD_FAILED:'사진 전송이 끝나지 않았어요. 일부 정보는 저장됐을 수 있으니 전체 저장을 다시 실행해주세요.',
  SIGNUP_FAILED:'가입 요청을 완료하지 못했어요. 이메일·비밀번호와 가입 설정을 확인해주세요.',
  DEMO_BLOCKED: '체험 옷장은 클라우드에 연결하지 않아요. 내 옷장으로 돌아가서 이용해주세요.',
  CONFIG_REQUIRED: 'Supabase 프로젝트 주소와 공개 연결 키를 먼저 입력해주세요.',
  INVALID_CONFIG: 'HTTPS 프로젝트 주소와 공개 연결 키를 확인해주세요. 비밀 키는 입력할 수 없어요.',
  AUTH_REQUIRED: '로그인이 필요해요. 로그인 유효시간이 지났다면 다시 로그인해주세요.',
  AUTH_FAILED: '로그인하지 못했어요. 계정 정보와 프로젝트 설정을 확인해주세요.',
  EXPLICIT_UPLOAD_REQUIRED: '옷 정보 전송 확인을 선택한 뒤 동기화해주세요.',
  INVALID_WARDROBE: '옷 정보나 중복된 옷 번호를 확인해주세요.',
  INVALID_RESPONSE: '클라우드 응답을 확인하지 못했어요. 기기의 기존 옷장은 그대로 유지됩니다.',
  ACCOUNT_MISMATCH: '로그인한 계정과 옷장 응답이 달라 적용하지 않았어요.',
  REPOSITORY_NOT_CONFIGURED: '앱 서버의 Supabase 연결 설정이 아직 준비되지 않았어요.',
  SUPABASE_NOT_CONFIGURED: '앱 서버의 Supabase 연결 설정이 아직 준비되지 않았어요.',
  FORBIDDEN: '이 계정으로 옷장에 접근할 수 없어요. 연결 권한을 확인해주세요.',
  BUSY: '진행 중인 연결 작업이 끝난 뒤 다시 시도해주세요.',
  TIMEOUT: '연결 응답이 늦어 중단했어요. 기존 옷장은 그대로 유지됩니다.',
  CANCELLED: '연결 작업이 취소됐어요.',
  CONNECTION_FAILED: '클라우드 연결을 확인하지 못했어요. 기존 옷장은 그대로 유지됩니다.',
  SERVER_TARGET_MISMATCH: '로그인 프로젝트와 앱 서버의 저장 대상이 일치하는지 확인하지 못해 전송을 중단했어요.',
};
const failure = code => Object.assign(new Error(errors[code] || errors.CONNECTION_FAILED), {code});
const validString = value => typeof value === 'string' && value.length <= 200 && !/^(?:data:|blob:)/i.test(value.trim());
const safeToken = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\s\u0000-\u001f]/.test(value);

export function cloudWardrobeMetadata(wardrobe) {
  if (!Array.isArray(wardrobe) || wardrobe.length > 500) throw failure('INVALID_WARDROBE');
  const seen = new Set();
  return wardrobe.map(item => {
    if (!item || typeof item.id !== 'string' || !idPattern.test(item.id) || seen.has(item.id) || !categories.has(item.category)) throw failure('INVALID_WARDROBE');
    seen.add(item.id);
    const clean = {id:item.id};
    for (const key of fields) {
      const value = item[key];
      if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || validString(value)) clean[key] = value;
      else if (Array.isArray(value) && value.length <= 12 && value.every(v => validString(v) && v.length <= 80)) clean[key] = [...value];
    }
    return clean;
  });
}

// Explicit import adds missing IDs. Existing local fields, photos and edits win.
export function mergeCloudWardrobe(local, remote) {
  if (!Array.isArray(local)) throw failure('INVALID_WARDROBE');
  const clean = cloudWardrobeMetadata(remote), existing = new Set(local.map(item => item.id));
  const added = clean.filter(item => !existing.has(item.id));
  return {wardrobe:[...local, ...added], addedCount:added.length, keptLocalCount:clean.length - added.length};
}

function validateConfiguration(input) {
  let url;
  try {
    url = new URL(input?.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch { throw failure('INVALID_CONFIG'); }
  const key = input?.publishableKey;
  let legacyRole;
  try { legacyRole = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role; } catch {}
  if (typeof key !== 'string' || key.length > 8192 || /\s/.test(key) || (!key.startsWith('sb_publishable_') && legacyRole !== 'anon')) throw failure('INVALID_CONFIG');
  return {url:url.origin, publishableKey:key,authMode:input?.authMode==='demo'?'demo':'account'};
}

export function createCloudWardrobeController({fetchImpl=globalThis.fetch?.bind(globalThis), isDemo=()=>false, onState=()=>{}, now=()=>Date.now(), timeoutMs=15000,demoSessionStore=null}={}) {
  let config=null, session=null, epoch=0, active=null, verifiedTarget=false,cloudRevision=null;
  let state={configured:false, projectUrl:'', signedIn:false, userId:null, busy:false, status:'local', error:null, cloudCount:null, linkedIds:[], lastSyncAt:null};
  const snapshot=()=>structuredClone({...state, demo:isDemo()});
  const publish=patch=>{state={...state,...patch};onState(snapshot());};
  const guard=()=>{if(isDemo())throw failure('DEMO_BLOCKED');};
  const clearSession=()=>{session=null;verifiedTarget=false;cloudRevision=null;publish({signedIn:false,userId:null,cloudCount:null,linkedIds:[],lastSyncAt:null,revision:null});};
  function sessionToken() {
    if(isDemo() || !session)return null;
    if(session.expiresAt<=now()){if(!session.refreshToken)clearSession();return null;}
    return session.accessToken;
  }
  const requireSession=()=>{const token=sessionToken();if(!token)throw failure('AUTH_REQUIRED');return token;};
  const demoKey=()=> 'closet-demo-session-v25:'+config.url;
  function rememberDemo(){if(config?.authMode!=='demo'||!session)return;try{if(!demoSessionStore)throw Error();demoSessionStore.setItem(demoKey(),JSON.stringify(session));}catch{throw failure('DEMO_SESSION_STORAGE');}}
  async function request(url, options, signal) {
    const response=await fetchImpl(url,{...options,signal,redirect:'error',cache:'no-store',credentials:'omit'});
    if(!response.ok){
      let code;try{const detail=await response.json();code=detail.code||detail.error_code;}catch{}
      if(code==='anonymous_provider_disabled')throw failure('DEMO_IDENTITY_DISABLED');
      if(code==='40001'||code==='PT409')throw failure('REVISION_CONFLICT');
      if(response.status===401)throw failure('AUTH_REQUIRED');
      if(response.status===403)throw failure('FORBIDDEN');
      throw failure(Object.hasOwn(errors,code)?code:'CONNECTION_FAILED');
    }
    if(response.status===204)return null;
    try{return await response.json();}catch{throw failure('INVALID_RESPONSE');}
  }
  async function run(status, task, operationTimeout=timeoutMs) {
    guard();if(active)throw failure('BUSY');
    const current=++epoch, controller=new AbortController();active=controller;
    let timer;
    publish({busy:true,status,error:null});
    const ensureCurrent=()=>{if(current!==epoch || controller.signal.aborted || isDemo())throw failure('CANCELLED');};
    try {
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('TIMEOUT'));},operationTimeout);});
      const result=await Promise.race([task(controller.signal,ensureCurrent),deadline]);
      ensureCurrent();return result;
    }catch(error){
      const safe=failure(Object.hasOwn(errors,error?.code)?error.code:'CONNECTION_FAILED');
      if(current===epoch){if(['AUTH_REQUIRED','ACCOUNT_MISMATCH','DEMO_SESSION_STORAGE'].includes(safe.code))clearSession();publish({status:'error',error:safe.message});}
      throw safe;
    }finally{clearTimeout(timer);if(current===epoch){active=null;publish({busy:false});}}
  }
  const authHeaders=token=>({'Content-Type':'application/json',apikey:config.publishableKey,...(token?{Authorization:'Bearer '+token}:{})});
  async function renewedSession(signal,current){
    if(session?.refreshToken&&session.expiresAt-now()<60000){
      const data=await request(config.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:authHeaders(),body:JSON.stringify({refresh_token:session.refreshToken})},signal);current();
      if(!safeToken(data.access_token)||!safeToken(data.refresh_token)||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw failure('AUTH_REQUIRED');
      const user=await request(config.url+'/auth/v1/user',{headers:authHeaders(data.access_token)},signal);current();
      if(user.id!==session.userId||(config.authMode!=='demo'&&user.is_anonymous))throw failure('ACCOUNT_MISMATCH');
      session={...session,accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:now()+data.expires_in*1000};rememberDemo();
    }
    return requireSession();
  }
  async function rpc(name,body,token,signal,current){const data=await request(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:authHeaders(token),body:JSON.stringify(body)},signal);current();return data;}
  async function verifyServerTarget(signal,current) {
    verifiedTarget=false;
    const settings=await request('/api/config',{},signal);current();
    let target;try{target=new URL(settings?.supabase?.url);}catch{}
    if(settings?.supabase?.enabled!==true || !target || target.origin!==config?.url || target.pathname!=='/' || target.search || target.hash)throw failure('SERVER_TARGET_MISMATCH');
    verifiedTarget=true;
  }
  function wardrobeResult(data, expectedIds=null) {
    if(!data || !data.user || typeof data.user.id!=='string' || !Array.isArray(data.wardrobe))throw failure('INVALID_RESPONSE');
    if(data.user.id!==session?.userId)throw failure('ACCOUNT_MISMATCH');
    let wardrobe;try{wardrobe=cloudWardrobeMetadata(data.wardrobe);}catch{throw failure('INVALID_RESPONSE');}
    if(expectedIds&&(wardrobe.length!==expectedIds.size||wardrobe.some(item=>!expectedIds.has(item.id))))throw failure('INVALID_RESPONSE');
    return wardrobe;
  }
  return {
    getState:snapshot,
    // Recommendation requests may use the token only after the server target was checked.
    getAccessToken:()=>verifiedTarget?sessionToken():null,
    configure(input){guard();if(active)throw failure('BUSY');config=validateConfiguration(input);clearSession();publish({configured:true,authMode:config.authMode,projectUrl:config.url,status:'configured',error:null});return snapshot();},
    connectDemo(){return run('signing-in',async(signal,current)=>{
      if(config?.authMode!=='demo')throw failure('CONFIG_REQUIRED');
      await verifyServerTarget(signal,current);
      let saved;try{if(!demoSessionStore)throw Error();const raw=demoSessionStore.getItem(demoKey());saved=raw?JSON.parse(raw):null;}catch{throw failure('DEMO_SESSION_STORAGE');}
      if(saved){
        if(!safeToken(saved.accessToken)||!safeToken(saved.refreshToken)||typeof saved.userId!=='string'||!Number.isFinite(saved.expiresAt))throw failure('AUTH_REQUIRED');
        session=saved;await renewedSession(signal,current);
      }else{
        const data=await request(config.url+'/auth/v1/signup',{method:'POST',headers:authHeaders(),body:'{}'},signal);current();
        if(!safeToken(data.access_token)||!safeToken(data.refresh_token)||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw failure('INVALID_RESPONSE');
        session={accessToken:data.access_token,refreshToken:data.refresh_token,userId:data.user?.id,expiresAt:now()+data.expires_in*1000};
      }
      const user=await request(config.url+'/auth/v1/user',{headers:authHeaders(session.accessToken)},signal);current();
      if(user.id!==session.userId||user.is_anonymous!==true)throw failure('ACCOUNT_MISMATCH');
      rememberDemo();publish({signedIn:true,userId:user.id,status:'demo-connected',error:null});return snapshot();
    });},
    signup({email,password}={}){return run('signing-up',async(signal,current)=>{
      if(!config)throw failure('CONFIG_REQUIRED');
      if(typeof email!=='string'||!email.trim()||typeof password!=='string'||password.length<8)throw failure('SIGNUP_FAILED');
      await request(config.url+'/auth/v1/signup',{method:'POST',headers:authHeaders(),body:JSON.stringify({email:email.trim(),password})},signal);current();
      publish({status:'verification-sent'});return snapshot();
    });},
    login({email,password}={}){
      return run('signing-in',async(signal,current)=>{
        if(!config)throw failure('CONFIG_REQUIRED');
        if(typeof email!=='string'||!email.trim()||typeof password!=='string'||!password)throw failure('AUTH_FAILED');
        clearSession();
        let data;try{data=await request(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:authHeaders(),body:JSON.stringify({email:email.trim(),password})},signal);}catch(error){if(error.code==='AUTH_REQUIRED'||error.code==='FORBIDDEN')throw failure('AUTH_FAILED');throw error;}
        current();
        if(!safeToken(data?.access_token) || !Number.isFinite(data.expires_in) || data.expires_in<=0)throw failure('INVALID_RESPONSE');
        const user=await request(config.url+'/auth/v1/user',{headers:authHeaders(data.access_token)},signal);
        current();
        if(typeof user?.id!=='string'||!user.id||user.is_anonymous===true)throw failure('AUTH_FAILED');
        session={accessToken:data.access_token,refreshToken:safeToken(data.refresh_token)?data.refresh_token:null,userId:user.id,expiresAt:now()+data.expires_in*1000};
        publish({signedIn:true,userId:user.id,status:'connected',error:null});return snapshot();
      });
    },
    load(){return run('loading',async(signal,current)=>{
      const token=requireSession();
      await verifyServerTarget(signal,current);
      const data=await request('/api/wardrobe',{headers:{Authorization:'Bearer '+token}},signal);current();
      const wardrobe=wardrobeResult(data);
      publish({status:'loaded',cloudCount:wardrobe.length,linkedIds:wardrobe.map(item=>item.id)});
      return wardrobe;
    });},
    upload(wardrobe,{confirmUpload=false}={}){return run('uploading',async(signal,current)=>{
      if(confirmUpload!==true)throw failure('EXPLICIT_UPLOAD_REQUIRED');
      const token=requireSession(),clean=cloudWardrobeMetadata(wardrobe);
      if(!clean.length)throw failure('INVALID_WARDROBE');
      await verifyServerTarget(signal,current);
      const data=await request('/api/wardrobe',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({confirmUpload:true,wardrobe:clean})},signal);current();
      const result=wardrobeResult(data,new Set(clean.map(item=>item.id)));
      publish({status:'synced',cloudCount:result.length,linkedIds:result.map(item=>item.id),lastSyncAt:new Date(now()).toISOString()});return result;
    });},
    inspect(){return run('loading',async(signal,current)=>{
      const token=await renewedSession(signal,current);await verifyServerTarget(signal,current);
      const data=checkCloudSnapshot(await rpc('closet_load_state',{},token,signal,current),session.userId);cloudRevision=data.revision;
      publish({status:'inspected',revision:data.revision,cloudCount:data.garments.length});return {revision:data.revision,count:data.garments.length};
    });},
    saveState(local,{confirmUpload=false}={}){return run('uploading',async(signal,current)=>{
      if(confirmUpload!==true)throw failure('EXPLICIT_UPLOAD_REQUIRED');
      let token=await renewedSession(signal,current);await verifyServerTarget(signal,current);
      if(cloudRevision===null){const remote=checkCloudSnapshot(await rpc('closet_load_state',{},token,signal,current),session.userId);if(remote.revision>0||remote.garments.length)throw failure('CLOUD_REVIEW_REQUIRED');cloudRevision=0;}
      const userId=session.userId,{payload,photos}=await encodeCloudState(local,userId);current();
      const data=checkCloudSnapshot(await rpc('closet_save_state',{p_state:payload,p_expected_revision:cloudRevision},token,signal,current),userId);
      cloudRevision=data.revision;publish({revision:data.revision,progress:'옷 정보 저장됨 · 사진 확인 중'});
      const media=snapshotMedia(data);let completed=0;
      for(const m of media){
        if(m.status!=='ready'){
          token=await renewedSession(signal,current);
          await uploadCloudPhoto({url:config.url,key:config.publishableKey,token,media:m,blob:photos.get(m.object_path),fetchImpl,signal});current();
          await rpc('closet_finish_media',{p_path:m.object_path,p_expected_revision:cloudRevision},token,signal,current);
        }
        publish({progress:`사진 ${++completed}/${media.length} 확인됨`});
      }
      const final=checkCloudSnapshot(await rpc('closet_load_state',{},token,signal,current),userId);
      if(final.revision!==cloudRevision)throw failure('REVISION_CONFLICT');
      if(snapshotMedia(final).some(m=>m.status!=='ready'))throw failure('MEDIA_INCOMPLETE');
      publish({status:'full-synced',progress:null,cloudCount:final.garments.length,linkedIds:final.garments.map(g=>g.id),lastSyncAt:new Date(now()).toISOString()});return {revision:cloudRevision};
    },300000);},
    restoreState(){return run('loading',async(signal,current)=>{
      const token=await renewedSession(signal,current);await verifyServerTarget(signal,current);
      const data=checkCloudSnapshot(await rpc('closet_load_state',{},token,signal,current),session.userId);
      if(data.revision===0)throw failure('CLOUD_EMPTY');
      const local=await decodeCloudState(data,session.userId,async m=>{
        const r=await fetchImpl(config.url+'/storage/v1/object/authenticated/closet-media/'+m.object_path,{headers:authHeaders(token),signal,redirect:'error',credentials:'omit'});current();if(!r.ok)throw failure('PHOTO_INTEGRITY');const blob=await r.blob();current();return blob;
      });current();cloudRevision=data.revision;
      publish({status:'full-loaded',revision:data.revision,cloudCount:local.closet.length,linkedIds:local.closet.map(g=>g.id)});return local;
    },300000);},
    cancel(){epoch++;active?.abort();active=null;publish({busy:false,status:session?'connected':'local',error:null});},
    async logout(){
      if(config?.authMode==='demo')try{demoSessionStore?.removeItem?.(demoKey());}catch{}
      const token=session?.accessToken;epoch++;active?.abort();active=null;clearSession();publish({busy:false,status:'local',error:null});
      if(!token||!config||isDemo())return;
      return run('signing-out',async(signal,current)=>{await request(config.url+'/auth/v1/logout?scope=local',{method:'POST',headers:authHeaders(token)},signal);current();publish({status:'local'});});
    },
  };
}

const statusLabels={'demo-connected':'데모 저장 공간 연결됨 · 회원가입 없이 이용할 수 있어요.',local:'이 기기에 저장 중',configured:'연결 준비 완료 · 로그인 전','signing-up':'가입 요청 중','verification-sent':'가입 확인 이메일을 확인한 뒤 로그인해주세요.', 'signing-in':'로그인 중',connected:'로그인됨 · 전체 저장 버튼으로 계정에 저장할 수 있어요.',loading:'클라우드 자료 확인 중',inspected:'클라우드 상태 확인됨 · 가져오기 또는 전체 저장을 선택해주세요.',uploading:'전체 저장 중 · 사진 전송이 끝날 때까지 기다려주세요.','full-synced':'사진·옷장·생활·착용 기록 저장 완료','full-loaded':'클라우드 자료 확인 완료','signing-out':'로그아웃 중',error:'연결 확인 필요'};
export function renderCloudWardrobePanel(state={}) {
 const blocked=state.demo===true,busy=state.busy===true,disabled=blocked||busy?' disabled':'',signedIn=state.signedIn===true,demoIdentity=state.authMode==='demo';
 return `<section class="cloud-wardrobe-panel"><h3>${demoIdentity?'데모 옷장 저장':'계정에 옷장 저장'}</h3><p>사진·분석 결과·생활 설정·착용 기록을 본인 계정에 저장합니다. 체험 옷장은 전송하지 않습니다.</p><p role="status">${escape(blocked?errors.DEMO_BLOCKED:statusLabels[state.status]||statusLabels.local)}</p>${state.progress?'<p>'+escape(state.progress)+'</p>':''}${state.error?'<p role="alert">'+escape(state.error)+'</p>':''}<details><summary>연결 설정 확인</summary><p>서버가 제공한 프로젝트에 연결합니다. 기본 설정이 없을 때만 직접 입력해주세요.</p><form data-cloud-form="config"><label>프로젝트 HTTPS 주소<input name="url" type="url" value="${escape(state.projectUrl)}" required${disabled}></label><label>공개 연결 키<input name="publishableKey" type="password" autocomplete="off" placeholder="sb_publishable_…" required${disabled}></label><button type="submit"${disabled}>연결 설정 적용</button></form></details>${signedIn?`${demoIdentity?'<p>이 브라우저의 전용 저장 공간입니다.</p>':'<p class="small-text">로그인 계정 번호: '+escape(state.userId)+'</p><button type="button" data-cloud-action="logout"'+disabled+'>로그아웃</button>'}<div class="cloud-sync-actions"><button type="button" data-cloud-action="inspect"${disabled}>클라우드 상태 확인</button><label><input type="checkbox" data-cloud-consent${disabled}> 현재 기기의 사진과 옷장·생활·착용 기록을 이 계정에 저장합니다. 계정의 옷 목록은 현재 목록으로 바뀝니다.</label><button type="button" data-cloud-action="upload"${disabled}>사진 포함 전체 저장</button><button type="button" data-cloud-action="load"${disabled}>클라우드 자료 가져오기</button></div>`:demoIdentity?`<p>이메일이나 비밀번호를 입력하지 않고 데모용 저장 공간에 연결합니다.</p><button type="button" data-cloud-action="connect-demo"${disabled}>데모 저장 연결</button>`:`<form data-cloud-form="login"><label>이메일<input name="email" type="email" autocomplete="username" required${disabled}></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required${disabled}></label><button type="submit"${disabled}${!state.configured?' disabled':''}>로그인</button><button type="submit" data-cloud-signup${disabled}${!state.configured?' disabled':''}>회원가입</button></form>`}<p class="small-text">변경 후 ‘사진 포함 전체 저장’을 눌러주세요. 자동 전송하지 않습니다. 가져오기 전 현재 기기 자료를 별도 백업하며, 사진을 모두 확인한 후 적용합니다. ${demoIdentity?'이 브라우저를 다시 열어도 같은 저장 공간에 연결합니다. 브라우저 데이터를 삭제하거나 다른 기기를 사용하면 기존 데모 저장 공간에 접근할 수 없으니 로컬 자료를 보존해주세요.':'새로고침하면 다시 로그인해주세요.'}</p>${Number.isSafeInteger(state.cloudCount)?'<p>최근 응답에서 확인한 옷: '+state.cloudCount+'개</p>':''}${state.lastSyncAt?'<p>마지막 전체 저장: '+escape(state.lastSyncAt)+'</p>':''}</section>`;
}
