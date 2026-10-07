// Cloud metadata is opt-in. This module never writes local storage or sends photos.
// Auth endpoints follow Supabase auth-js; ownership is verified again by the server.
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const fields = ['name','category','color','fit','officialSize','style','warmth','formal','comfort','available','officialColor','itemType','itemTypeSource','material','materialConfirmed','thickness','thicknessSource','thicknessEvidence','insulationVisual','insulationSource','insulationEvidence','length','colorFamily','colorLightness','colorChroma','colorHue','styleTags','moods','garmentKind','garmentKindConfirmed'];
const categories = new Set(['top','bottom','dress','shoe','outer']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const errors = {
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
  return {url:url.origin, publishableKey:key};
}

export function createCloudWardrobeController({fetchImpl=globalThis.fetch?.bind(globalThis), isDemo=()=>false, onState=()=>{}, now=()=>Date.now(), timeoutMs=15000}={}) {
  let config=null, session=null, epoch=0, active=null, verifiedTarget=false;
  let state={configured:false, projectUrl:'', signedIn:false, userId:null, busy:false, status:'local', error:null, cloudCount:null, linkedIds:[], lastSyncAt:null};
  const snapshot=()=>structuredClone({...state, demo:isDemo()});
  const publish=patch=>{state={...state,...patch};onState(snapshot());};
  const guard=()=>{if(isDemo())throw failure('DEMO_BLOCKED');};
  const clearSession=()=>{session=null;verifiedTarget=false;publish({signedIn:false,userId:null,cloudCount:null,linkedIds:[],lastSyncAt:null});};
  function sessionToken() {
    if(isDemo() || !session)return null;
    if(session.expiresAt<=now()){clearSession();return null;}
    return session.accessToken;
  }
  const requireSession=()=>{const token=sessionToken();if(!token)throw failure('AUTH_REQUIRED');return token;};
  async function request(url, options, signal) {
    const response=await fetchImpl(url,{...options,signal,redirect:'error',cache:'no-store',credentials:'omit'});
    if(!response.ok){
      let code;try{code=(await response.json()).code;}catch{}
      if(response.status===401)throw failure('AUTH_REQUIRED');
      if(response.status===403)throw failure('FORBIDDEN');
      throw failure(Object.hasOwn(errors,code)?code:'CONNECTION_FAILED');
    }
    if(response.status===204)return null;
    try{return await response.json();}catch{throw failure('INVALID_RESPONSE');}
  }
  async function run(status, task) {
    guard();if(active)throw failure('BUSY');
    const current=++epoch, controller=new AbortController();active=controller;
    let timer;
    publish({busy:true,status,error:null});
    const ensureCurrent=()=>{if(current!==epoch || controller.signal.aborted || isDemo())throw failure('CANCELLED');};
    try {
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('TIMEOUT'));},timeoutMs);});
      const result=await Promise.race([task(controller.signal,ensureCurrent),deadline]);
      ensureCurrent();return result;
    }catch(error){
      const safe=failure(Object.hasOwn(errors,error?.code)?error.code:'CONNECTION_FAILED');
      if(current===epoch){if(safe.code==='AUTH_REQUIRED')clearSession();publish({status:'error',error:safe.message});}
      throw safe;
    }finally{clearTimeout(timer);if(current===epoch){active=null;publish({busy:false});}}
  }
  const authHeaders=token=>({'Content-Type':'application/json',apikey:config.publishableKey,...(token?{Authorization:'Bearer '+token}:{})});
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
    configure(input){guard();if(active)throw failure('BUSY');config=validateConfiguration(input);clearSession();publish({configured:true,projectUrl:config.url,status:'configured',error:null});return snapshot();},
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
        session={accessToken:data.access_token,userId:user.id,expiresAt:now()+data.expires_in*1000};
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
    cancel(){epoch++;active?.abort();active=null;publish({busy:false,status:session?'connected':'local',error:null});},
    async logout(){
      const token=session?.accessToken;epoch++;active?.abort();active=null;clearSession();publish({busy:false,status:'local',error:null});
      if(!token||!config||isDemo())return;
      return run('signing-out',async(signal,current)=>{await request(config.url+'/auth/v1/logout?scope=local',{method:'POST',headers:authHeaders(token)},signal);current();publish({status:'local'});});
    },
  };
}

const statusLabels={local:'이 기기에 저장 중',configured:'연결 설정 완료 · 로그인 전','signing-in':'로그인 중',connected:'로그인됨 · 아직 자동 동기화하지 않음',loading:'클라우드 옷 정보 확인 중',loaded:'클라우드 옷 정보 조회 완료',uploading:'옷 정보 전송 중',synced:'선택한 옷 정보 동기화 완료','signing-out':'로그아웃 중',error:'연결 확인 필요'};
export function renderCloudWardrobePanel(state={}) {
  const blocked=state.demo===true, busy=state.busy===true, disabled=blocked||busy?' disabled':'';
  const signedIn=state.signedIn===true;
  return `<section class="cloud-wardrobe-panel"><h3>클라우드 옷장 연결</h3><p>옷의 이름·종류·색·직접 확인한 속성을 계정에 저장할 수 있어요. 사진과 분석 원문은 전송하지 않으며, 기존 기기 옷장은 유지됩니다.</p><p role="status">${escape(blocked?errors.DEMO_BLOCKED:statusLabels[state.status]||statusLabels.local)}</p>${state.error?`<p role="alert">${escape(state.error)}</p>`:''}<details><summary>연결 설정</summary><p class="small-text">앱 서버에 설정한 같은 Supabase 프로젝트를 사용해주세요. 공개 연결 키는 프로젝트를 식별하는 값이며, 비밀 키와 다릅니다.</p><form data-cloud-form="config"><label>프로젝트 HTTPS 주소<input name="url" type="url" autocomplete="off" value="${escape(state.projectUrl)}" placeholder="https://프로젝트.supabase.co" required${disabled}></label><label>공개 연결 키<input name="publishableKey" type="password" autocomplete="off" placeholder="sb_publishable_…" required${disabled}></label><button type="submit"${disabled}>연결 설정 적용</button></form></details>${signedIn?`<p class="small-text">로그인 계정 번호: ${escape(state.userId)}</p><button type="button" data-cloud-action="logout"${disabled}>로그아웃</button><div class="cloud-sync-actions"><label><input type="checkbox" data-cloud-consent${disabled}> 현재 옷장의 사진 제외 옷 정보를 계정에 전송하는 데 동의해요.</label><button type="button" data-cloud-action="upload"${disabled}>옷 정보 동기화</button><button type="button" data-cloud-action="load"${disabled}>클라우드 옷 정보 가져오기</button></div>`:`<form data-cloud-form="login"><label>이메일<input name="email" type="email" autocomplete="username" required${disabled}></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required${disabled}></label><button type="submit"${disabled}${!state.configured?' disabled':''}>로그인</button></form>`}<p class="small-text">가져오기는 기기에 없는 옷 번호만 추가합니다. 같은 번호의 기존 옷과 사진은 그대로 유지해요. 로그인은 이 화면을 닫거나 새로고침하면 다시 필요합니다.</p>${Number.isSafeInteger(state.cloudCount)&&state.cloudCount>=0?`<p>최근 응답에서 확인한 옷: ${state.cloudCount}개</p>`:''}${state.lastSyncAt?`<p class="small-text">마지막 동기화: ${escape(state.lastSyncAt)}</p>`:''}</section>`;
}
