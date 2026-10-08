import {preparePhotoUpload} from './photo-upload.js';
import {thicknessMetadata,thicknessLabel} from './thickness-policy.js';
import {warmthOptions,warmthValue,displayColor,garmentSizing,sizeCaption,mergeAnalysisDraft} from './garment-fields.js';
import {createRegionChooser} from './region-chooser.js';
import {installSurveyPicker} from './survey-picker.js';
import {holidayOnDate} from './holidays.js';
import {installClientLog} from './client-log.js';
const operationLog=installClientLog();
import {moodOptions,moodPreferences,moodLabels,officialStyleGroups,garmentStyleMetadata} from './style-taxonomy.js';
import {cityName,regionIds,temperaturePreferences,selectedWeather,styleOptions} from './user-settings.js';
import {analysisDraft,visionProgressText,visionClientTimeoutMs,validationMessages} from './vision-format.js';
import {todayKey,contexts,recommend,parseCapture,captureGroups,alternativeRegistration,comfortAdjustmentMessage,comfortTag} from './engine.js';
import {blankProfile,fresh,demoState,normalizeState} from './persona.js';
import {weatherPlan} from './conditions.js';
import {warmthBias,feedbackSeason} from './learning.js';
import {needsSetup,setupResult} from './onboarding.js';
import {createRecommendationController,recommendationToOutfit,recommendationWardrobe} from './frontend-recommendations.js';
import {renderRecommendationDiagnostics} from './frontend-diagnostics.js';
import {renderGarmentConfirmationFields,populateGarmentConfirmationFields,readGarmentConfirmationFields} from './frontend-garment-fields.js';
import {createCloudWardrobeController,renderCloudWardrobePanel} from './frontend-storage.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const colors={'검정':'#303431','흰색':'#f0eee3','회색':'#979e98','베이지':'#c6b99a','남색':'#374657','파랑':'#7495b2','초록':'#768772','갈색':'#8a6d57','분홍':'#c8a0a2','빨강':'#a4554f','노랑':'#d0b96b','보라':'#8e7b9c','혼합':'#929381'};
const categories={top:'상의',bottom:'하의',outer:'겉옷',shoe:'신발',dress:'원피스'};
const fits=['여유 있는 핏','기본 핏','몸에 맞는 핏'];
function updateGarmentCategory(){
 const form=$('#garmentForm'),shoe=form.elements.category.value==='shoe';
 $('#garmentFitField').hidden=shoe;form.elements.fit.disabled=shoe;
 $('#garmentSizeLabel').textContent=shoe?'신발 사이즈 (선택)':'공식 사이즈 (선택)';
 form.elements.officialSize.placeholder=shoe?'예: 245 mm / EU 38 / US 7':'예: M / 95 / 28인치';
 $('#garmentSizeHint').textContent=shoe?'단위도 함께 입력해주세요. 신발 사이즈는 사진에서 추정하지 않아요.':'상품이나 라벨에 적힌 사이즈를 입력해주세요. 사진에서 추정하지 않아요.';
 surveyPicker.refresh();
}
$('#garmentForm select[name="category"]').addEventListener('change',updateGarmentCategory);
let localMutation=0;
let db,state,mode='real',tab='today',modifier='',skip=0,currentOutfit=null,editingId=null,draftPhoto=null,draftCapture=null,draftReady=true;
let photoQueue=[],photoIndex=0,savingGarment=false;
function garmentId(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
let comfortReferenceIds=[];
let developerMode=false,recommendationData=null,recommendationKey='',recommendationEpoch=0,recommendationBusy=false,recommendationPending=null,wardrobeVersion=0,wardrobeFingerprint='',recommendationStateFingerprint='',modeSwitchBusy=false;
let cloudUiEnabled=false;
function renderCloudConnection(value){$('#cloudConnection').innerHTML=cloudUiEnabled?renderCloudWardrobePanel(value):'<p>이 데모는 로그인 없이 사용합니다. 옷과 설정은 현재 브라우저에 저장됩니다.</p>'; }
let demoSessionStore=null;try{demoSessionStore=window.localStorage;}catch{}
const cloudController=createCloudWardrobeController({demoSessionStore,isDemo:()=>mode==='demo',onState:renderCloudConnection});
function recommendationStateKey(){return JSON.stringify({mode,wardrobe:recommendationWardrobe(state.closet),profile:state.profile,context:ctx(),weather:activeWeather()});}
const recommendationController=createRecommendationController({getCurrentSnapshot:()=>({wardrobeRevision:currentWardrobeRevision(),wardrobe:state.closet}),getAccessToken:()=>cloudController.getAccessToken()});
function currentWardrobeRevision(){const fingerprint=mode+JSON.stringify(recommendationWardrobe(state.closet));if(fingerprint!==wardrobeFingerprint){wardrobeFingerprint=fingerprint;wardrobeVersion++;}return `${mode}:${wardrobeVersion}`;}
function clearRecommendation(){recommendationEpoch++;recommendationController.invalidate();recommendationKey='';recommendationData=null;recommendationBusy=false;recommendationPending=null;currentOutfit=null;$('#outfit').replaceChildren();$('#outfitReasons').replaceChildren();$('#outfitWarnings').replaceChildren();$('#outfitActions').hidden=true;$('#recommendationDiagnostics').innerHTML=renderRecommendationDiagnostics(null);}
function renderDisplayMode(){document.body.classList.toggle('developer-mode',developerMode);$('#displayModeButton').textContent=developerMode?'⚙️ 개발자 모드':'👤 사용자 모드';$('#displayModeButton').setAttribute('aria-pressed',String(developerMode));$('#recommendationDiagnostics').hidden=!developerMode;}
$('#displayModeButton').addEventListener('click',()=>{developerMode=!developerMode;renderDisplayMode();try{localStorage.setItem('closet-display-mode-v22',developerMode?'developer':'user');}catch{}});
$('#retryRecommendation').addEventListener('click',()=>{clearRecommendation();renderToday();});
$('#cloudConnection').addEventListener('submit',async event=>{
 const form=event.target.closest('[data-cloud-form]');if(!form)return;event.preventDefault();
 try{if(form.dataset.cloudForm==='config'){const input={url:form.elements.url.value.trim(),publishableKey:form.elements.publishableKey.value.trim()};form.elements.publishableKey.value='';cloudController.configure(input);}
 else{const input={email:form.elements.email.value,password:form.elements.password.value};form.elements.password.value='';if(event.submitter?.hasAttribute('data-cloud-signup'))await cloudController.signup(input);else await cloudController.login(input);}
 clearRecommendation();renderToday();}catch(error){toast(error.message);}
});
$('#cloudConnection').addEventListener('click',async event=>{
 const button=event.target.closest('[data-cloud-action]');if(!button)return;
 const targetState=state,targetMode=mode,targetMutation=localMutation;
 try{
  if(button.dataset.cloudAction==='logout'){await cloudController.logout();clearRecommendation();renderToday();}
  if(button.dataset.cloudAction==='connect-demo')await cloudController.connectDemo();
  if(button.dataset.cloudAction==='inspect')await cloudController.inspect();
  if(button.dataset.cloudAction==='upload'){const consent=$('#cloudConnection [data-cloud-consent]')?.checked===true;await cloudController.saveState(structuredClone(state),{confirmUpload:consent});if(state!==targetState||mode!==targetMode)return;clearRecommendation();renderToday();toast(localMutation===targetMutation?'사진과 옷장·생활·기록을 계정에 저장했어요.':'전송 중 바뀐 기기 자료가 있어요. 전체 저장을 한 번 더 눌러주세요.');}
  if(button.dataset.cloudAction==='load'){
   if(!confirm('클라우드 자료를 가져올까요? 현재 기기 자료는 별도로 백업한 뒤 바뀝니다.'))return;
   const remote=await cloudController.restoreState();if(state!==targetState||mode!==targetMode||localMutation!==targetMutation){toast('가져오는 동안 기기 자료가 바뀌어 적용하지 않았어요. 다시 시도해주세요.');return;}
   const backupKey='before-cloud-import:'+garmentId();await writeState(backupKey,structuredClone(state));await writeState('last-cloud-import-backup-key',backupKey);
   const restored=normalizeState(remote);await writeState('real',restored);state=restored;localMutation++;clearRecommendation();render();toast('사진과 옷장·생활·착용 기록을 가져왔어요.');
  }
 }catch(error){toast(error.message);}
});
$('#restoreLocalBackup').addEventListener('click',async()=>{try{if(mode==='demo'){toast('내 옷장으로 돌아와서 복원해주세요.');return;}if(cloudController.getState().busy){toast('진행 중인 연결이 끝난 뒤 복원해주세요.');return;}const key=await readState('last-cloud-import-backup-key'),backup=key?await readState(key):null;if(!backup){toast('이 브라우저에는 가져오기 전 백업이 없어요.');return;}if(!confirm('가져오기 전 기기 자료를 복원할까요? 현재 자료도 별도 백업합니다.'))return;await writeState('before-local-restore:'+garmentId(),structuredClone(state));const restored=normalizeState(backup);await writeState('real',restored);state=restored;localMutation++;clearRecommendation();render();toast('기기 자료를 복원했어요. 클라우드 자료는 바뀌지 않았어요.');}catch{toast('복원하지 못했어요. 기존 자료는 유지합니다.');}});
let draftVision=null,draftRevision=0,analysisController=null,analysisTimer=null,lastAIValues=null;
const editedAnalysisFields=new Set();
for(const event of ['input','change'])$('#garmentForm').addEventListener(event,e=>{if(e.target.name)editedAnalysisFields.add(e.target.name);});
let geminiBudgetReady=false;
async function configureCloudFromServer(){cloudUiEnabled=apiConfig?.supabase?.enabled===true;$$('[data-tab="cloud"]').forEach(button=>button.hidden=!cloudUiEnabled);renderCloudConnection(cloudController.getState());if(mode!=='demo'&&apiConfig?.supabase?.enabled&&apiConfig.supabase.publishableKey&&!cloudController.getState().configured){cloudController.configure({url:apiConfig.supabase.url,publishableKey:apiConfig.supabase.publishableKey,authMode:apiConfig.supabase.authMode});if(apiConfig.supabase.authMode==='demo')try{await cloudController.connectDemo();}catch(error){toast(error.message);}}}
async function refreshGeminiBudget(){
 try{const r=await fetch('/api/gemini-budget',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error();const b=await r.json();geminiBudgetReady=b.canRequest;$('#geminiBudgetStatus').textContent='테스트 예상 누적 비용: 약 '+Math.ceil(b.estimatedUsedWon).toLocaleString('ko-KR')+'원 / '+b.capWon.toLocaleString('ko-KR')+'원'+(b.uncertainAttempts?' · 비용 확인 대기 '+b.uncertainAttempts+'건':'')+(b.canRequest?'':' · 추가 분석 중단');}
 catch{geminiBudgetReady=false;$('#geminiBudgetStatus').textContent='테스트 비용 기록을 확인하지 못해 분석을 잠시 중단했어요.';}
 updateAnalyzeButton();
}
let draftCutout=null,cutoutController=null,cutoutTimer=null,photoView='original';
let weatherRevision=0;
let urlCache=[];let photoPreviewUrl=null;let toastTimer;let alternativeRequested=false;let weatherRetryTimer;let registeredRegionKey="";
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function openDB(){operationLog.event('storage_open_started');return new Promise((resolve,reject)=>{const r=indexedDB.open('closet-agent-preview-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('states');r.onsuccess=()=>{operationLog.event('storage_open_finished');resolve(r.result);};r.onerror=()=>{operationLog.event('storage_open_failed',{errorName:r.error?.name});reject(r.error);};});}
function readState(key){operationLog.event('storage_read_started');return new Promise((resolve,reject)=>{const tx=db.transaction('states');const r=tx.objectStore('states').get(key);r.onsuccess=()=>{operationLog.event('storage_read_finished');resolve(r.result);};r.onerror=()=>{operationLog.event('storage_read_failed',{errorName:r.error?.name});reject(r.error);};});}
function writeState(key,value){operationLog.event('storage_write_started');return new Promise((resolve,reject)=>{const tx=db.transaction('states','readwrite');tx.objectStore('states').put(value,key);tx.oncomplete=()=>{operationLog.event('storage_write_finished');resolve();};tx.onerror=()=>{operationLog.event('storage_write_failed',{errorName:tx.error?.name});reject(tx.error);};tx.onabort=()=>{operationLog.event('storage_write_failed',{errorName:tx.error?.name});reject(tx.error);};});}
async function save(){if(wardrobeFingerprint&&wardrobeFingerprint!==mode+JSON.stringify(recommendationWardrobe(state.closet))){modifier='';skip=0;comfortReferenceIds=[];}if(recommendationStateFingerprint&&recommendationStateFingerprint!==recommendationStateKey())clearRecommendation();const clock=performance.now();operationLog.event('storage_started',{source:mode,count:state.closet.length});try{await writeState(mode==='demo'?'mvp-demo-v1':'real',state);localMutation++;operationLog.event('storage_finished',{elapsedMs:performance.now()-clock});return true;}catch(error){operationLog.event('storage_failed',{errorName:error.name,elapsedMs:performance.now()-clock});toast('저장 공간에 기록하지 못했어요. 사진 크기나 브라우저 저장 설정을 확인해 주세요.');return false;}}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4300);}
function activeWeather(){return selectedWeather(state,todayKey());}
function recommendationWeather(){
 if(!recommendationData)return activeWeather();const w=recommendationData.weather;
 if(typeof w?.temperatureMin!=='number'||typeof w?.temperatureMax!=='number')return null;
 return {min:w.temperatureMin,max:w.temperatureMax,humidity:w.humidity,source:w.kind==='observation'?'추천에 사용한 기상청 관측':'추천에 사용한 기상청 예보',place:regionIds(state).map(cityName).join(' · ')||'추천 서버',stale:w.stale,fetchedAt:w.fetchedAt,rain:w.rain??null};
}
function ctx(){const text=state.schedule?.date===todayKey()?state.schedule.text:'';return {...contexts(state.profile,text,todayKey(),[],holidayOnDate(state.holidayCalendar,todayKey())),warmthBias:warmthBias(state.feedback,activeWeather())};}
function icon(category,color){const fill=colors[color]||'#929381';const paths={top:'M35 15 49 9h22l14 6 21 21-15 19-14-10v67H43V45L29 55 14 36Z',outer:'M36 13 50 7h20l14 6 22 28-16 17-13-13v67H43V45L30 58 14 41Z',bottom:'M35 12h50l4 99H65l-5-61-5 61H31Z',dress:'M44 10h10l6 10 6-10h10l7 39 19 61H18l19-61Z',shoe:'M19 58h26l13 14 37 11q15 5 13 18H17q-10-18 2-43Z'};return `<svg viewBox="0 0 120 125" aria-hidden="true"><path d="${paths[category]||paths.top}" fill="${fill}" stroke="#263c322b" stroke-width="1.5"/>${category==='outer'?'<path d="M60 10v102M48 16l12 24 12-24" fill="none" stroke="#263c324d" stroke-width="2"/>':''}${category==='top'?'<path d="M49 9q11 17 22 0" fill="none" stroke="#263c3244" stroke-width="2"/>':''}${category==='bottom'?'<path d="M35 25h50M60 12v28" stroke="#263c3244" fill="none"/>':''}</svg>`;}
function visual(item){let art=icon(item.category,item.color);if(item.cutout?.photo||item.photo){const url=URL.createObjectURL(item.cutout?.photo||item.photo);urlCache.push(url);art=`<img src="${url}" alt="${esc(item.name)} 사진" onerror="this.hidden=true">`;}return `<div class="garment-visual ${item.cutout?.photo?'has-cutout':''}">${art}<span class="category-badge">${item.candidate?'구매 후보':esc(categories[item.category])}</span></div>`;}
function itemCard(item){return `<div>${visual(item)}<p class="garment-name">${esc(item.name)}${item.candidate?' <span class="purchase-candidate">구매 후보</span>':''}</p><p class="garment-info">${esc(item.colorDescription||displayColor(item.color))} · ${esc(sizeCaption(item))}</p></div>`;}
function resetURLs(){for(const u of urlCache)URL.revokeObjectURL(u);urlCache=[];}
function showTab(next){if(next==='cloud'&&!cloudUiEnabled)next='today';if(needsSetup(state,mode)&&next!=='cloud')next='setup';if(!['today','closet','profile','purchase','setup','cloud'].includes(next))next='today';tab=next;operationLog.event('screen_opened',{source:next});document.body.classList.toggle('setup-active',next==='setup');if(next==='setup')fillSetup();history.replaceState(null,'','#'+next);$$('.view').forEach(v=>v.hidden=v.id!==next);$$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===next));if(next==='profile'){fillProfile();renderMemory();}if(next==='closet')renderCloset();window.scrollTo({top:0,behavior:'smooth'});}
function renderAlternativeNotice(){
 const box=$('#alternativeNotice'),count=currentOutfit?.total;
 box.hidden=!alternativeRequested||count>1;
 box.innerHTML=box.hidden?'':'<h3>지금 조건에서 다른 조합이 없어요</h3><p>입을 수 있는 옷과 오늘 조건으로 확인한 결과예요. 옷의 세부 종류·보온 정보를 확인하거나 다른 옷을 추가해보세요.</p><button class="secondary" data-tab="closet">옷 정보 확인하기</button>';
}
function renderWeatherSummary(weather=activeWeather()){
 $('#weatherSummary').innerHTML=weather?`${weather.rangeKind==='forecast-hours'?'<p class="small-text">조회된 예보: '+weather.fromHour+'~'+weather.throughHour+'시 기온 범위</p>':''}<p class="weather-value">${Math.round(weather.min)}° <span style="font-size:17px;color:var(--muted)">—</span> ${Math.round(weather.max)}°</p><p class="small-text">${esc(weather.place||'직접 입력')} · ${esc(weather.source)}${weather.stale?' · 이전 예보':''}${weather.base?' · 발표 '+Number(weather.base.base_time.slice(0,2))+'시':''}${weather.fetchedAt?' · 확인 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'numeric'}).format(new Date(weather.fetchedAt)):''}${weather.rain!=null?' · 강수 확률 '+weather.rain+'%':''}</p>`:'<p class="small-text">오늘 날씨가 아직 확인되지 않았어요.</p>';
 if(weather?.forecasts?.length){$('#weatherSummary').insertAdjacentHTML('beforeend',weather.forecasts.map(f=>'<p class="small-text">'+esc(cityName(f.placeId))+' · '+Math.round(f.min)+'°~'+Math.round(f.max)+'° · '+(f.rain==null?'강수 확률 미확인':'강수 확률 '+f.rain+'%')+(f.stale?' · 이전 예보':'')+(f.base?' · 발표 '+Number(f.base.base_time.slice(0,2))+'시':'')+(f.fetchedAt?' · 확인 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'numeric'}).format(new Date(f.fetchedAt)):'')+'</p>').join(''));if(weather.partial)$('#weatherSummary').insertAdjacentHTML('beforeend','<p class="warning">'+esc(weather.missingPlaces.join(' · '))+' 예보는 미확인이에요. 준비사항은 확인된 지역만 기준으로 계산했어요.</p>');}
 if(weather?.nextUpdateAt)$('#weatherSummary').insertAdjacentHTML('beforeend','<p class="small-text">다음 예보 갱신: '+nextWeatherTime(weather.nextUpdateAt)+' 이후</p>');
}
function nextWeatherTime(time){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'numeric'}).format(new Date(time));}
function wantsSavedWeather(){return regionIds(state||{}).length&&(state.weatherMode==='saved'||!state.weatherMode&&state.weather?.source==='기상청 단기예보');}
function renderTodayContext(c=ctx()){
 const chips=[c.routine,c.remote?'재택':'',c.autoHoliday?'공휴일 · 휴일로 준비':c.exception?'평소 활동 변경':'',c.walking>=15?'도보 이동 많음':'',c.cooling?'실내 냉방':'',/약속|식사/.test(c.text)?'약속 있음':''];
 $('#conditionSummary').innerHTML=chips.filter(Boolean).map(s=>`<span class="condition-chip">${esc(s)}</span>`).join('')||'<span class="small-text">평소 생활을 저장하면 여기에 함께 반영돼요.</span>';
 if(document.activeElement!==$('#schedule'))$('#schedule').value=state.schedule?.date===todayKey()?state.schedule.text:'';
 renderHolidayStatus(c);
}
function renderToday(){
 const c=ctx(),weather=activeWeather(),options={modifier,skip,referenceIds:comfortReferenceIds,history:state.history.filter(h=>h.date!==todayKey()).slice(-100),topK:5};
 renderTodayContext(c);
 const input={wardrobeRevision:currentWardrobeRevision(),wardrobe:state.closet,profile:state.profile,context:{...c,locationIds:regionIds(state),weather,weatherMode:state.weatherMode,wardrobeMode:mode},options};
 const key=JSON.stringify({...input,wardrobe:recommendationWardrobe(state.closet)});
 if(key===recommendationKey){if(recommendationBusy)return recommendationPending;if(currentOutfit){renderTodayView();return Promise.resolve();}}
 recommendationController.invalidate();const epoch=++recommendationEpoch;recommendationKey=key;recommendationData=null;recommendationBusy=true;currentOutfit=null;
 recommendationStateFingerprint=recommendationStateKey();
 $('#outfit').innerHTML='<div class="empty-state"><h2>오늘의 조합을 비교하고 있어요.</h2><p>옷 정보와 날씨에 맞는 후보를 확인합니다.</p></div>';
 $('#outfit').setAttribute('aria-busy','true');$('#outfitReasons').replaceChildren();$('#outfitWarnings').replaceChildren();$('#outfitActions').hidden=true;
 $('#recommendationStatus').textContent='추천을 준비하고 있어요…';$('#retryRecommendation').hidden=true;$('#outfitTag').textContent='추천 준비 중';
 $('#recommendationDiagnostics').innerHTML=renderRecommendationDiagnostics(null);renderWeatherSummary(weather);renderActions();renderDisplayMode();
 operationLog.event('recommendation_started',{count:state.closet.length});
 recommendationPending=recommendationController.request(input).then(result=>{
  if(epoch!==recommendationEpoch||result.status==='ignored')return;
  recommendationBusy=false;$('#outfit').setAttribute('aria-busy','false');
  if(result.status==='ready'){
   recommendationData=result.data;currentOutfit=recommendationToOutfit(result.data,state.closet);
   $('#recommendationStatus').textContent=result.data.source==='gemini'?'옷장에 있는 옷으로 추천했어요.':'등록한 옷과 조건을 비교한 규칙 기반 추천이에요.';
   $('#recommendationDiagnostics').innerHTML=renderRecommendationDiagnostics(result.data,{clientMs:result.elapsedMs});
   operationLog.event('recommendation_finished',{elapsedMs:result.elapsedMs,outfitReady:!!currentOutfit.outfit});
  }else{
   currentOutfit=recommend(state.closet,state.profile,c,weather,options);currentOutfit.source='rules';
   $('#recommendationStatus').textContent=(result.error?.message||'추천 서버에 연결하지 못했어요.')+' 이 브라우저의 규칙 기반 조합을 보여드려요.';$('#retryRecommendation').hidden=false;
   $('#recommendationDiagnostics').innerHTML=renderRecommendationDiagnostics(null,{clientMs:result.elapsedMs});
   operationLog.event('recommendation_failed',{errorName:result.error?.code,elapsedMs:result.elapsedMs});
  }
  renderTodayView();
 }).catch(()=>{if(epoch!==recommendationEpoch)return;recommendationBusy=false;recommendationKey='';currentOutfit=null;$('#outfit').setAttribute('aria-busy','false');$('#outfitActions').hidden=true;$('#recommendationStatus').textContent='추천 결과를 표시하지 못했어요. 다시 시도해주세요.';$('#retryRecommendation').hidden=false;});
 return recommendationPending;
}
function renderTodayView(){
 const c=ctx(),weather=recommendationWeather();
 const readableReasons=(currentOutfit.reasons||[]).filter(text=>typeof text==='string'&&!/[+-]?\d+(?:\.\d+)?점을|색.*점수|종합.*점수/.test(text));
 const stylingReasons=readableReasons.length?readableReasons:[currentOutfit.outfit?.some(item=>item.category==='outer')?'상의와 하의의 색을 함께 살펴보고, 겉옷은 실내외 온도에 맞춰 입고 벗어보세요.':'추천한 옷을 함께 입어보고, 활동할 때의 움직임과 실내외 온도를 확인해보세요.'];
 renderTodayContext(c);
 $('#outfitActions').hidden=!currentOutfit.outfit;$('#adjustmentStatus').hidden=true;$('#adjustmentStatus').textContent='';$('#comfortAlternatives').hidden=true;$('#comfortAlternativeList').replaceChildren();
 $$('[data-adjust]').forEach(button=>button.disabled=recommendationBusy);$('#wearButton').disabled=recommendationBusy;
 $('#outfitTag').textContent=currentOutfit.outfit?(modifier==='comfort'?comfortTag(currentOutfit):modifier==='formal'?(currentOutfit.formalAdjustment?.status==='improved'?'격식을 높인 조합':currentOutfit.formalAdjustment?.status==='alternative'?'같은 격식의 다른 조합':'단정함을 비교한 조합'):'가진 옷으로 준비했어요'):'옷장을 기다리고 있어요';
 if(!currentOutfit.outfit){$('#outfit').innerHTML=`<div class="empty-state"><span>◒</span><h2>${state.closet.length?'조합할 옷을 조금 더 알려주세요.':'이번 계절에 자주 입는 옷부터 넣어주세요.'}</h2><p>${state.closet.length?'확인이 필요한 항목: '+esc(currentOutfit.missing.join('·'))+'.':'평소 입는 코디 한 세트를 등록하면 시작할 수 있어요. 상의와 하의를 하나씩 더 넣으면 다른 조합도 찾아드릴 수 있어요.'}</p>${state.closet.length?'<p class="small-text">입을 수 있는 상태, 세부 종류·보온 정보와 오늘의 날씨·일정 조건을 확인해주세요. 등록 개수만으로 다른 조합을 막지 않아요.</p>':''}<button class="primary" data-tab="closet">옷장 등록하기</button>${mode==='real'?'<button class="secondary" id="emptyDemo">예시로 먼저 체험</button>':''}</div>`;$('#outfitReasons').innerHTML='';$('#outfitWarnings').innerHTML='';}
 else{$('#outfit').innerHTML=currentOutfit.outfit.map(itemCard).join('');$('#outfitReasons').innerHTML='<div class="outfit-reasons">'+stylingReasons.slice(0,2).map(r=>`<p class="reason"><b>✓</b>${esc(r)}</p>`).join('')+(stylingReasons.length>2?'<details class="more-reasons"><summary>추천 기준 더 보기</summary>'+stylingReasons.slice(2).map(r=>`<p class="reason"><b>✓</b>${esc(r)}</p>`).join('')+'</details>':'')+'</div>';$('#outfitWarnings').innerHTML=currentOutfit.notices.map(n=>`<p class="warning">${esc(n)}</p>`).join('');}
 if(modifier==='formal'&&currentOutfit.outfit){$('#adjustmentStatus').textContent=currentOutfit.formalAdjustment?.message||'등록된 격식으로 조합을 비교했어요. 더 높은 격식의 후보가 없으면 동등한 대안을 보거나 같은 조합을 유지할 수 있어요.';$('#adjustmentStatus').hidden=false;}
 if(modifier==='comfort'&&currentOutfit.outfit){$('#adjustmentStatus').textContent=currentOutfit.comfortAdjustment?.message||comfortAdjustmentMessage(state.closet,c,currentOutfit);$('#adjustmentStatus').hidden=false;
  const options=currentOutfit.comfortAdjustment?.alternatives||[];
  $('#comfortAlternatives').hidden=!options.length;
  $('#comfortAlternativeList').innerHTML=options.map(a=>'<article class="comfort-option"><strong>'+esc(a.category+' · '+a.name)+'</strong><p>'+esc(a.selected?'이번에 교체한 옷이에요.':a.eligible?'교체 가능한 후보예요. 한 번에 한 종류만 바꾸므로 다음 클릭에서 다시 비교해요.':a.reasons[0])+'</p>'+'<p class="small-text">등록된 세부 종류: '+esc(a.itemType||'아직 모름')+'</p>'+(a.kindHint?'<p class="small-text">'+esc(a.kindHint)+'</p>':'')+(a.basis.length?'<p class="small-text">비교 근거: '+esc(a.basis.join(' · '))+'</p>':'')+a.reasons.slice(a.eligible?0:1).map(r=>'<p class="small-text">'+esc(r)+'</p>').join('')+'<button type="button" class="text-button" data-edit="'+esc(a.id)+'">옷 정보 확인·수정</button></article>').join('');
 }
 renderHolidayStatus(c);renderWeatherSummary(weather);
 $('#weatherMin').value=weather?.rangeKind==='forecast-hours'?'':weather?.min??'';$('#weatherMax').value=weather?.rangeKind==='forecast-hours'?'':weather?.max??'';$('#weatherRain').value=weather?.rangeKind==='forecast-hours'?'':weather?.rain??'';$('#weatherSnow').checked=weather?.snow===true;
 const selected=state.history.find(h=>h.date===todayKey()&&h.signature===currentOutfit.signature);$('#selectionStatus').textContent=selected?'오늘 입을 조합으로 기록했어요.':'';
 renderAlternativeNotice();renderActions();renderLearning();if(mode==='demo')$('#modeNotice').textContent='예시 옷장 '+state.closet.length+'개로 체험 중이에요. 내 옷장과 따로 저장됩니다. 추천에 사용한 날씨는 아래 날씨 정보를 확인해주세요.';
}
function renderCloset(){
 const items=state.closet;const counts=alternativeRegistration(items).counts;$('#closetCount').textContent='상의 '+counts.top+' · 하의 '+counts.bottom+' · 신발 '+counts.shoe+' · 겉옷 '+counts.outer;$('#closetGrid').innerHTML=items.length?items.map(i=>`<article class="closet-card ${i.available?'':'unavailable'}">${itemCard(i)}<p class="small-text">${i.capture?esc(i.capture.raw)+(i.capture.offset?' '+esc(i.capture.offset):' · 시간대 미기록'):'촬영 기록 없음'}${i.capture?.model?'<br>'+esc(i.capture.model):''}</p>${i.officialColor?'<p class="small-text">공식 참고: '+esc(i.officialColor)+'</p>':''}<div class="card-actions"><button data-available="${esc(i.id)}">${i.available?'입을 수 있음 ✓':'세탁·보관 중'}</button><button data-edit="${esc(i.id)}">수정</button><button data-delete="${esc(i.id)}">삭제</button></div></article>`).join(''):'<div class="empty-state"><span>＋</span><h2>아직 등록한 옷이 없어요.</h2><p>자주 입는 옷부터 하나씩 기억해둘게요.</p></div>';
 const groups=captureGroups(items);$('#captureGroups').innerHTML=groups.map(g=>{const signature=g.map(i=>i.id).sort().join('|');const confirmed=state.confirmedGroups.includes(signature);return `<div class="capture-box"><strong>비슷한 시간대에 촬영한 사진 ${g.length}장</strong>${g.map(i=>esc(i.name)).join(' · ')}<p class="small-text">${esc(g[0].capture.model)} · 첫 사진부터 10분 이내라는 임시 비교 기준입니다. 같은 기기 모델은 같은 기기라는 보장이 없고, 시간만으로 조명이나 보정값을 확정하지 않아요.</p><button class="secondary" data-group="${esc(signature)}" ${confirmed?'disabled':''}>${confirmed?'같은 장소·조명으로 확인했어요':'같은 장소·조명에서 찍었어요'}</button></div>`;}).join('');
}
function fillProfile(){fillRegionChoices('#profileLocations',regionIds(state));fillTemperatures('#profileForm',temperaturePreferences(state.profile));const selected=moodPreferences(state.profile);$$('#profileStyles input').forEach(el=>el.checked=selected.includes(el.value));const form=$('#profileForm');for(const key of ['routine','dressCode','walking','fit','exposure'])form.elements[key].value=state.profile[key]??'';form.elements.cooling.value=state.profile.cooling==null?'':String(state.profile.cooling);form.elements.heating.value=state.profile.heating==null?'':String(state.profile.heating);$$('#weekdayChecks input').forEach(i=>i.checked=state.profile.days.includes(Number(i.value)));surveyPicker.refresh();}
function render(){resetURLs();$('#modeNotice').hidden=mode!=='demo';$('#modeNotice').textContent='예시 옷장 '+state.closet.length+'개로 체험 중이에요. 내 옷장과 따로 저장됩니다. 추천에 사용한 날씨는 아래 날씨 정보를 확인해주세요.';$('#modeButton').textContent=mode==='demo'?'내 옷장으로 돌아가기':'12개 옷장으로 체험하기';renderToday();renderCloset();renderCloudConnection(cloudController.getState());if(tab==='profile'){fillProfile();renderMemory();}}
async function toggleMode(){
 if(modeSwitchBusy)return;modeSwitchBusy=true;$('#modeButton').disabled=true;
 const next=mode==='real'?'demo':'real',previousMode=mode;
 try{const data=await readState(next==='demo'?'mvp-demo-v1':'real');const nextState=normalizeState(data||(next==='demo'?demoState():fresh()));nextState.holidayCalendar=state.holidayCalendar||nextState.holidayCalendar;
  if(!data)await writeState(next==='demo'?'mvp-demo-v1':'real',nextState);await writeState('mvp-active-mode',next);
  clearRecommendation();cloudController.cancel();if($('#garmentDialog').open)$('#garmentDialog').close();mode=next;state=nextState;await configureCloudFromServer();modifier='';skip=0;comfortReferenceIds=[];alternativeRequested=false;render();showTab('today');await refreshHolidays();$('#purchaseResult').innerHTML='<div class="empty-state"><h2>옷장을 기준으로 새롭게 비교해요.</h2><p>구매 후보 정보를 입력해 주세요.</p></div>';
 }catch{if(mode===previousMode)toast('옷장을 전환하지 못했어요. 현재 옷장을 유지합니다.');else toast('옷장은 전환했지만 연결 정보를 갱신하지 못했어요.');}
 finally{modeSwitchBusy=false;$('#modeButton').disabled=false;}
}
function stopAnalysis(){if(analysisController)analysisController.abort();analysisController=null;clearInterval(analysisTimer);analysisTimer=null;$('#cancelAnalysis').hidden=true;$('#saveGarment').disabled=!!cutoutController;}
function updateAnalyzeButton(){const supported=draftPhoto&&draftPhoto.size<=10*1024*1024&&/image\/(jpeg|png|webp)/.test(draftPhoto.type);$('#analyzePhoto').disabled=!supported||!draftReady||!!analysisController||!geminiBudgetReady;}
function clearAIValues(){if(lastAIValues){const f=$('#garmentForm');for(const [k,v] of Object.entries(lastAIValues))if(!editedAnalysisFields.has(k)&&f.elements[k]?.value===v)f.elements[k].value='';}lastAIValues=null;}
function resetDraft(clearInput=true){editedAnalysisFields.clear();draftRevision++;stopAnalysis();stopCutout();draftCutout=null;photoView='original';$('#cutoutStatus').textContent='배경 제거는 Gemini 사용량과 별개예요. 옷의 모양은 그대로 유지해요.';$('#photoPreview').classList.remove('cutout-preview');draftVision=null;if(photoPreviewUrl)URL.revokeObjectURL(photoPreviewUrl);photoPreviewUrl=null;draftPhoto=null;draftCapture=null;draftReady=true;$('#photoPreview').innerHTML='';$('#photoMetadata').textContent='';$('#garmentStatus').textContent='';$('#analysisResult').hidden=true;$('#analysisResult').innerHTML='';$('#analysisDiagnostics').hidden=true;$('#diagnosticContent').innerHTML='';$('#analysisStatus').textContent='사진을 먼저 선택해주세요.';if(clearInput){$('#photoInput').value='';$('#cameraInput').value='';}updateAnalyzeButton();updateCutoutButton();}
function renderAnalysis(record){const box=$('#analysisResult');box.hidden=false;const labels={category:'종류',item_type:'세부 종류',main_color:'근접 색상',pattern:'무늬',surface_visual:'표면',silhouette_visual:'사진상 형태',length_visual:'보이는 기장',thickness_visual:'두께 · AI 추정',insulation_visual:'보이는 보온 구조'};const a=record.analysis;box.innerHTML='<strong>'+ (record.userReview?.status==='confirmed_in_app'?'등록 당시 Gemini 원본 분석 · 두께 추정 유지':'사진 분석 결과 · 확인 전')+'</strong><dl>'+Object.entries(a.attributes).map(([k,v])=>'<div><dt>'+esc(labels[k])+'</dt><dd>'+esc(k==='thickness_visual'?thicknessLabel(v.value):k==='insulation_visual'?({brushed_lining:'기모 단서',lining:'안감 단서',padding_structure:'충전 구조 단서'}[v.value]||'미확인'):v.value||'모름')+(v.uncertainty!=='명확함'?' <span class="small-text">('+esc(v.uncertainty)+')</span>':'')+((k==='thickness_visual'||k==='insulation_visual')&&v.evidence?'<br><small>'+esc(v.evidence)+'</small>':'')+'</dd></div>').join('')+'</dl><p class="small-text">'+esc(a.photo_quality.lighting_note)+'</p><p class="small-text">'+esc(a.photo_quality.occlusion_note)+'</p><p class="small-text">색은 가까운 계열이면 괜찮아요. 아래 값을 확인하거나 수정해주세요. 실제 착용 핏은 직접 입력할 수 있어요.</p>'+(a.photo_quality.usable_for_registration==='재촬영 권장'?'<p class="warning">다른 사진으로 다시 분석하는 것을 권장해요.</p>':'');}
function renderTiming(client,server){const labels={client_started:'분석 시작',file_read_started:'사진 읽기 시작',file_read_finished:'사진 읽기 완료',client_payload_started:'전송 준비 시작',client_payload_finished:'전송 준비 완료',fetch_started:'앱 서버 요청',fetch_headers_received:'앱 응답 도착',client_json_started:'응답 해석 시작',client_json_finished:'응답 해석 완료',ui_apply_started:'화면 반영 시작',ui_apply_finished:'화면 반영 완료',client_failed:'요청 중단/오류',request_received:'서버 요청 수신',request_body_started:'사진 수신 시작',request_body_finished:'사진 수신 완료',image_validation_started:'사진 검증 시작',image_validation_finished:'사진 검증 완료',config_read_started:'키 설정 읽기 시작',config_read_finished:'키 설정 읽기 완료',gemini_payload_started:'Gemini 요청 준비',gemini_payload_finished:'Gemini 요청 준비 완료',gemini_request_started:'Google로 요청 시작',gemini_socket_ready:'연결 준비·전송 시작',gemini_upload_finished:'Google로 사진 전송 완료',gemini_headers_received:'Google 응답 도착',gemini_body_started:'Google 결과 읽기',gemini_body_finished:'Google 결과 읽기 완료',output_validation_started:'결과 검증 시작',output_validation_finished:'결과 검증 완료',output_validation_failed:'결과 검증 실패',retry_wait_started:'재시도 대기 시작',retry_wait_finished:'재시도 대기 완료',response_prepared:'앱 응답 준비 완료',response_finished:'앱 응답 전송 완료',request_failed:'서버 중단/오류'};Object.assign(labels,{gemini_error_received:'Google 오류 원인 확인',quota_cooldown:'사용량 제한 대기',client_started:'분석 시작',file_read_started:'사진 읽기 시작',file_read_finished:'사진 읽기 완료',client_payload_started:'전송 준비 시작',client_payload_finished:'전송 준비 완료'});const rows=record=>(record?.timeline||[]).map(e=>'<tr><td>'+esc(labels[e.stage]||e.stage)+(e.validationIssue?'<br><span class="small-text">'+esc(validationMessages[e.validationIssue]||'결과 양식 확인 필요')+'<br>'+esc(e.validationPath||'')+'</span>':'')+(e.attempt?' #'+e.attempt:'')+'</td><td>'+(e.elapsedMs/1000).toFixed(3)+'초</td></tr>').join('');$('#analysisDiagnostics').hidden=false;$('#diagnosticContent').innerHTML='<p class="small-text">추적 번호: '+esc(client?.requestId||server?.requestId||'')+'</p><p class="small-text">각 표의 시작부터 누적된 시간이에요. Google 응답 대기에는 통신과 모델 처리가 함께 포함돼요.</p><strong>휴대폰/브라우저</strong><table><tbody>'+rows(client)+'</tbody></table>'+(server?'<strong>앱 서버 → Google</strong><table><tbody>'+rows(server)+'</tbody></table>':'');}
function openGarment(item=null,{keepQueue=false}={}){if(!keepQueue){photoQueue=[];photoIndex=0;}resetDraft();lastAIValues=null;editingId=item?.id||null;const form=$('#garmentForm');form.reset();populateGarmentConfirmationFields(form,item||{});if(item?.thicknessSource==='user'||item?.thickness&&!item?.thicknessSource)editedAnalysisFields.add('thickness');form.querySelectorAll('[data-legacy-style]').forEach(option=>option.remove());$('#garmentTitle').textContent=item?'옷 정보 수정':'옷 추가';if(item){if(item.style&&![...form.elements.style.options].some(o=>o.value===item.style)){const option=document.createElement('option');option.value=item.style;option.textContent=item.style+' (기존 기록 유지)';option.disabled=true;option.dataset.legacyStyle='true';form.elements.style.append(option);}for(const k of ['name','category','color','colorDescription','itemType','pattern','surface','silhouette','lengthDescription','fit','style','warmth','formal','officialColor','officialSize','url'])form.elements[k].value=(k==='color'?displayColor(item[k]):item[k])??'';form.elements.available.checked=Boolean(item.available);form.elements.comfort.value=item.comfort==null?'':String(item.comfort);draftPhoto=item.photo;draftCapture=item.capture;draftVision=item.vision||null;lastAIValues=draftVision?.analysis?analysisDraft(draftVision.analysis):null;if(item.photo){photoPreviewUrl=URL.createObjectURL(item.photo);$('#photoPreview').innerHTML='<img src="'+photoPreviewUrl+'" alt="등록한 옷 사진">';}$('#photoMetadata').textContent=item.capture?'촬영 기록: '+item.capture.raw:'촬영 기록 없음';if(draftVision){renderAnalysis(draftVision);if(draftVision.diagnostics)renderTiming(draftVision.clientDiagnostics,draftVision.diagnostics);$('#analysisStatus').textContent='저장된 분석 결과예요. 사진을 바꾸지 않았다면 다시 분석할 필요가 없어요.';}}draftCutout=item?.cutout||null;photoView=draftCutout?'cutout':'original';renderPhotoPreview();$('#cutoutStatus').textContent=draftCutout?'등록할 사진: 배경 없는 사진. 원본도 함께 보관해요.':'배경 제거는 Gemini 사용량과 별개예요. 옷의 모양은 그대로 유지해요.';updateCutoutButton();updateAnalyzeButton();updateGarmentCategory();if(!$('#garmentDialog').open)$('#garmentDialog').showModal();updateQueueStatus();}
$('#modeButton').addEventListener('click',()=>toggleMode().catch(()=>toast('옷장을 불러오지 못했어요.')));
document.addEventListener('click',async e=>{
 if(e.target.closest('.brand')){e.preventDefault();showTab('today');}
 const nav=e.target.closest('[data-tab]');if(nav)showTab(nav.dataset.tab);
 if(e.target.closest('#emptyDemo'))await toggleMode();
 const a=e.target.closest('[data-adjust]');if(a){if(recommendationBusy||!currentOutfit?.outfit)return;const beforeIds=currentOutfit.outfit.map(i=>i.id).sort().join('|'),previousModifier=modifier;if(a.dataset.adjust==='other'){
  alternativeRequested=true;
  if(!modifier&&currentOutfit.total<=1){renderAlternativeNotice();toast('현재 조건에서 만들 수 있는 다른 조합이 없어요.');return;}
  modifier='';comfortReferenceIds=[];skip++;if(!previousModifier&&skip>=currentOutfit.total){skip=0;toast('가능한 조합을 한 바퀴 살펴봤어요.');}
 }else{comfortReferenceIds=(currentOutfit.outfit||[]).map(i=>i.id);modifier=a.dataset.adjust;skip=0;}resetURLs();await renderToday();
  if(a.dataset.adjust==='other'&&currentOutfit?.outfit&&currentOutfit.outfit.map(i=>i.id).sort().join('|')===beforeIds){
   const next=recommendationData?.looks.find(look=>[...look.itemIds].sort().join('|')!==beforeIds);
   if(next){recommendationData={...recommendationData,selectedLookId:next.candidateId};currentOutfit=recommendationToOutfit(recommendationData,state.closet);$('#recommendationDiagnostics').innerHTML=renderRecommendationDiagnostics(recommendationData,{clientMs:recommendationController.state.elapsedMs});renderTodayView();}
   else toast('현재 조건에서 확인된 다른 조합이 없어 현재 코디를 유지했어요.');
  }
 }
 const available=e.target.closest('[data-available]');if(available){const item=state.closet.find(i=>i.id===available.dataset.available);const wasAvailable=item.available;item.available=!item.available;if(!await save())item.available=wasAvailable;skip=0;render();}
 const edit=e.target.closest('[data-edit]');if(edit)openGarment(state.closet.find(i=>i.id===edit.dataset.edit));
 const del=e.target.closest('[data-delete]');if(del){const item=state.closet.find(i=>i.id===del.dataset.delete);if(confirm('옷장에서 “'+item.name+'”을 삭제할까요?')){const previousCloset=state.closet;state.closet=state.closet.filter(i=>i.id!==item.id);if(!await save())state.closet=previousCloset;skip=0;render();}}
 const group=e.target.closest('[data-group]');if(group){state.confirmedGroups.push(group.dataset.group);await save();renderCloset();toast('촬영 환경 확인을 기록했어요. 색상 보정은 아직 적용하지 않았어요.');}
});
$('#applySchedule').addEventListener('click',async()=>{const previous=state.schedule;state.schedule={date:todayKey(),text:$('#schedule').value.trim()};modifier='';skip=0;comfortReferenceIds=[];const saved=await save();if(!saved)state.schedule=previous;resetURLs();renderToday();if(saved)toast('오늘의 변경 사항을 반영했어요.');});
$('#wearButton').addEventListener('click',async()=>{if(recommendationBusy||!currentOutfit?.outfit)return;const previousHistory=state.history;state.history=state.history.filter(h=>h.date!==todayKey());state.history.push({date:todayKey(),ids:currentOutfit.outfit.map(i=>i.id),signature:currentOutfit.signature,names:currentOutfit.outfit.map(i=>i.name)});if(await save()){$('#selectionStatus').textContent='오늘 입을 조합으로 기록했어요. 취향은 임의로 바꾸지 않아요.';toast('오늘 입을 옷이 준비됐어요.');renderLearning();renderMemory();}else state.history=previousHistory;});
$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const previous={profile:state.profile,answers:[...state.answers],locationIds:state.locationIds,locationId:state.locationId};state.profile={...state.profile,routine:f.elements.routine.value,days:$$('#weekdayChecks input:checked').map(i=>Number(i.value)),dressCode:f.elements.dressCode.value===''?null:Number(f.elements.dressCode.value),walking:f.elements.walking.value===''?null:Number(f.elements.walking.value),cooling:f.elements.cooling.value===''?null:f.elements.cooling.value==='true',heating:f.elements.heating.value===''?null:f.elements.heating.value==='true',exposure:f.elements.exposure.value,sensitivities:new FormData(f).getAll('sensitivities'),sensitive:new FormData(f).getAll('sensitivities')[0]||'',fit:f.elements.fit.value,moodPreferences:moodPreferences({moodPreferences:new FormData(f).getAll('moodPreferences')})};for(const key of ['exposure','cooling','heating','walking','fit'])if(state.profile[key]!==''&&!state.answers.some(a=>a.key===key&&a.value===state.profile[key]&&!a.skipped))state.answers.push({key,value:state.profile[key],date:todayKey(),source:'생활 설정'});const ids=checkedRegions('#profileLocations');state.locationIds=ids;state.locationId=ids[0]||null;weatherRevision++;skip=0;modifier='';if(await save()){$('#profileStatus').textContent='기억했어요. 다음에도 같은 생활을 불러올게요.';renderToday();renderMemory();fillRegionChoices('#places',regionIds(state));if(regionIds(state).length&&apiConfig.weatherKeyPresent)refreshWeather({quiet:true});toast('평소 생활을 기억했어요.');}else{Object.assign(state,previous);renderToday();$('#profileStatus').textContent='저장하지 못해 이전 설정을 유지했어요. 다시 저장해주세요.';}});
$('#openGarment').addEventListener('click',()=>needsSetup(state,mode)?showTab('setup'):openGarment());$('#closeGarment').addEventListener('click',()=>$('#garmentDialog').close());
function updateQueueStatus(){$('#photoQueueStatus').textContent=photoQueue.length>1?photoQueue.length+'장 선택 · '+(photoIndex+1)+'번째 옷 확인 중. 등록하면 다음 사진으로 넘어가요.':'';$('#saveGarment').textContent=photoQueue.length>photoIndex+1?'등록하고 다음 사진 확인':'확인하고 옷장에 등록';}
$('#garmentDialog').addEventListener('close',()=>{draftRevision++;stopAnalysis();stopCutout();photoQueue=[];photoIndex=0;});
async function choosePhoto(e){
 const files=Array.from(e.target.files||[]);if(!files.length)return;operationLog.event('photo_selected',{count:files.length,source:e.target.id==='cameraInput'?'camera':'gallery'});
 if(files.length>20){operationLog.event('photo_rejected',{count:files.length});$('#analysisStatus').textContent='한 번에 최대 20장까지 선택해주세요.';return;}
 if(files.some(file=>file.size>20*1024*1024)){operationLog.event('photo_rejected');$('#analysisStatus').textContent='20MB 이하 사진만 선택해주세요. 자동 분석은 10MB까지 가능해요.';return;}
 if(files.some(file=>!/^image\//.test(file.type)&&!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))){$('#analysisStatus').textContent='사진 파일만 선택해주세요.';return;}
 photoQueue=files;photoIndex=0;await processPhoto(files[0]);updateQueueStatus();
}
async function processPhoto(file){
 if(file.size>20*1024*1024){$('#analysisStatus').textContent='20MB 이하 사진을 선택해주세요. 자동 분석은 10MB까지 가능해요.';return;}
 if(!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)&&!/^image\//.test(file.type)){$('#analysisStatus').textContent='옷 사진 파일을 선택해주세요.';return;}
 clearAIValues();resetDraft(false);draftReady=false;draftPhoto=file;const revision=draftRevision;$('#photoMetadata').textContent='촬영 기록을 읽고 있어요…';
 photoPreviewUrl=URL.createObjectURL(file);const img=document.createElement('img');img.alt='추가할 옷 사진';img.src=photoPreviewUrl;img.onerror=()=>{if(revision!==draftRevision)return;operationLog.event('photo_preview_failed');img.hidden=true;$('#photoPreview').textContent='이 형식은 미리보기를 표시하지 못했어요. 원본과 직접 입력한 정보는 저장할 수 있어요.';};$('#photoPreview').append(img);
 operationLog.event('photo_metadata_started',{bytes:file.size,mimeType:file.type});const metaClock=performance.now();
 try{const meta=await window.exifr.parse(file,{pick:['DateTimeOriginal','OffsetTimeOriginal','Make','Model','Flash','WhiteBalance'],reviveValues:false,translateValues:false,gps:false});if(revision!==draftRevision)return;const capture=parseCapture(meta?.DateTimeOriginal,meta?.OffsetTimeOriginal);if(capture){draftCapture={...capture,make:meta.Make||'',model:meta.Model||'',flash:meta.Flash??null,whiteBalance:meta.WhiteBalance??null};$('#photoMetadata').textContent='촬영 기록: '+capture.raw+(capture.offset?' '+capture.offset:' · 시간대 미기록')+(meta.Model?' · '+meta.Model:'');}else $('#photoMetadata').textContent='촬영 기록이 없어요. 사진 분석과 등록은 가능해요.';}catch(error){operationLog.event('photo_metadata_failed',{errorName:error.name});if(revision===draftRevision)$('#photoMetadata').textContent='촬영 기록을 읽지 못했어요. 사진 분석과 등록은 가능해요.';}
 finally{operationLog.event('photo_metadata_finished',{elapsedMs:performance.now()-metaClock});if(revision===draftRevision){draftReady=true;updateAnalyzeButton();updateCutoutButton();$('#analysisStatus').textContent=$('#analyzePhoto').disabled?'자동 분석은 JPEG·PNG·WebP 10MB 이하를 지원해요. 다른 형식은 직접 입력해 등록할 수 있어요.':'사진이 준비됐어요. 사진 분석하기를 눌러주세요.';}}
}
$('#photoInput').addEventListener('change',choosePhoto);$('#cameraInput').addEventListener('change',choosePhoto);
async function photoRequestHeaders(requestId){
 if(apiConfig?.supabase?.enabled&&mode!=='demo'&&!cloudController.getAccessToken())await cloudController.connectDemo();
 const token=cloudController.getAccessToken();return {'Content-Type':'application/json','X-Analysis-Id':requestId,...(token?{Authorization:'Bearer '+token}:{})};
}
function updateCutoutButton(){const supported=draftPhoto&&draftPhoto.size<=10*1024*1024&&/^image\/(jpeg|png|webp)$/.test(draftPhoto.type);$('#removePhotoBackground').disabled=apiConfig?.features?.cutout===false||!supported||!draftReady||!!cutoutController||!!draftCutout;$('#photoViewControls').hidden=!draftCutout;$('#cancelCutout').hidden=!cutoutController;if(apiConfig?.features?.cutout===false)$('#cutoutStatus').textContent='배경 제거 서비스를 준비하고 있어요. 원본 사진으로 등록할 수 있어요.';}
function stopCutout(){cutoutController?.abort();cutoutController=null;clearInterval(cutoutTimer);cutoutTimer=null;$('#cancelCutout').hidden=true;$('#saveGarment').disabled=!!analysisController;}
function renderPhotoPreview(){if(photoPreviewUrl)URL.revokeObjectURL(photoPreviewUrl);photoPreviewUrl=null;const photo=photoView==='cutout'&&draftCutout?draftCutout.photo:draftPhoto;const box=$('#photoPreview');box.classList.toggle('cutout-preview',photoView==='cutout'&&!!draftCutout);box.innerHTML='';if(photo){photoPreviewUrl=URL.createObjectURL(photo);const img=document.createElement('img');img.src=photoPreviewUrl;img.alt=photoView==='cutout'?'배경을 제거한 옷 사진':'원본 옷 사진';box.append(img);}}
$('#showOriginalPhoto').addEventListener('click',()=>{photoView='original';renderPhotoPreview();});
$('#showCutoutPhoto').addEventListener('click',()=>{photoView='cutout';renderPhotoPreview();});
$('#discardCutout').addEventListener('click',()=>{draftCutout=null;photoView='original';renderPhotoPreview();updateCutoutButton();$('#cutoutStatus').textContent='원본 사진으로 등록해요. 배경 제거본을 저장하지 않아요.';});
$('#cancelCutout').addEventListener('click',()=>{stopCutout();updateCutoutButton();$('#cutoutStatus').textContent='배경 제거를 취소했어요. 원본으로 등록할 수 있어요.';});
$('#removePhotoBackground').addEventListener('click',async()=>{
 if(!draftPhoto||!draftReady||cutoutController||draftCutout)return;
 const controller=new AbortController(),revision=draftRevision,file=draftPhoto,start=performance.now(),requestId=garmentId();operationLog.event('cutout_client_started',{},requestId);cutoutController=controller;updateCutoutButton();$('#saveGarment').disabled=true;$('#cutoutStatus').textContent='옷의 배경을 제거하고 있어요…';
 cutoutTimer=setInterval(()=>{$('#cutoutStatus').textContent='배경 제거 중 · '+Math.floor((performance.now()-start)/1000)+'초. 첫 처리는 모델 준비로 조금 더 걸릴 수 있어요.';},1000);
 try{const payload=await preparePhotoUpload(file);if(controller.signal.aborted)return;const response=await fetch('/api/photo-cutout',{method:'POST',headers:await photoRequestHeaders(requestId),body:JSON.stringify(payload),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(115000)])});const result=await response.json();if(revision!==draftRevision||controller.signal.aborted||cutoutController!==controller)return;if(!response.ok)throw new Error(result.error||'배경 제거를 완료하지 못했어요.');
  const bytes=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));const {data:unused,...metadata}=result;draftCutout={...metadata,photo:new Blob([bytes],{type:'image/png'})};photoView='cutout';renderPhotoPreview();const elapsedMs=performance.now()-start;operationLog.event('cutout_ui_applied',{elapsedMs},requestId);$('#cutoutStatus').textContent='배경 제거 완료 · '+(elapsedMs/1000).toFixed(1)+'초'+(result.cached?' · 저장 결과 재사용':'')+'. 옷 일부가 지워졌다면 원본으로 등록해주세요. 원본도 함께 보관해요.';
 }catch(error){operationLog.event('cutout_client_failed',{elapsedMs:performance.now()-start,errorName:error.name},requestId);if(revision===draftRevision&&!controller.signal.aborted&&cutoutController===controller)$('#cutoutStatus').textContent=error.name==='TimeoutError'?'배경 제거 시간이 길어졌어요. 원본으로 등록하거나 다시 시도해주세요.':error.message;}
 finally{if(cutoutController===controller){stopCutout();updateCutoutButton();}}
});
$('#cancelAnalysis').addEventListener('click',()=>{stopAnalysis();$('#analysisStatus').textContent='분석을 취소했어요. 다시 분석하거나 직접 입력할 수 있어요.';updateAnalyzeButton();});
$('#analyzePhoto').addEventListener('click',async()=>{
 if(!draftPhoto||!draftReady||analysisController)return;
 const revision=draftRevision,file=draftPhoto,controller=new AbortController(),requestId=garmentId(),clock=performance.now(),client={requestId,timeline:[]};let serverTiming=null;
 const mark=stage=>{const elapsedMs=Math.round((performance.now()-clock)*100)/100;client.timeline.push({stage,elapsedMs});operationLog.event(stage,{elapsedMs},requestId);};mark('client_started');operationLog.event('analysis_input_selected',{source:'original',hasCutout:!!draftCutout},requestId);
 analysisController=controller;updateAnalyzeButton();$('#saveGarment').disabled=true;$('#cancelAnalysis').hidden=false;$('#analysisStatus').textContent='사진을 분석하고 있어요…';const start=Date.now();analysisTimer=setInterval(()=>{$('#analysisStatus').textContent=visionProgressText(Date.now()-start);},1000);
 try{
  mark('file_read_started');const payload=await preparePhotoUpload(file);mark('file_read_finished');if(controller.signal.aborted)return;
  mark('client_payload_started');const body=JSON.stringify(payload);mark('client_payload_finished');mark('fetch_started');
  const response=await fetch('/api/garment-analysis',{method:'POST',headers:await photoRequestHeaders(requestId),body,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(visionClientTimeoutMs)])});mark('fetch_headers_received');mark('client_json_started');const record=await response.json();mark('client_json_finished');serverTiming=record.diagnostics||null;if(revision!==draftRevision||controller.signal.aborted)return;if(!response.ok)throw new Error(record.error||'분석을 완료하지 못했어요.');
  mark('ui_apply_started');draftVision=record;const values=analysisDraft(record.analysis);const form=$('#garmentForm'),current=Object.fromEntries(Object.keys(values).map(k=>[k,form.elements[k].value])),merged=mergeAnalysisDraft(current,lastAIValues,values,{editedFields:[...editedAnalysisFields]});for(const [k,v] of Object.entries(merged.values))form.elements[k].value=v;lastAIValues=values;updateGarmentCategory();renderAnalysis(record);$('#analysisStatus').textContent='분석 완료 · '+(record.elapsedMs/1000).toFixed(1)+'초. '+(merged.preserved.length?'직접 입력·수정한 '+merged.preserved.length+'개 항목을 유지했어요. ':'')+'아래 내용을 확인하고 등록해주세요.';mark('ui_apply_finished');record.clientDiagnostics=client;
 }catch(error){mark(controller.signal.aborted?'client_cancelled':'client_failed');if(revision===draftRevision&&!controller.signal.aborted)$('#analysisStatus').textContent=error.name==='TimeoutError'?'분석 서버 응답을 기다리다 시간이 초과됐어요. 다시 분석하거나 직접 입력해주세요.':error.message||'분석 연결을 확인해주세요.';}
 finally{
  if(controller.signal.aborted)mark('client_cancelled');
  await refreshGeminiBudget();
  try{const r=await fetch('/api/analysis-trace?'+new URLSearchParams({request:requestId}),{signal:AbortSignal.timeout(2000)});if(r.ok)serverTiming=await r.json();}catch{}
  if(revision===draftRevision){renderTiming(client,serverTiming);if(draftVision?.clientDiagnostics?.requestId===requestId)draftVision.diagnostics=serverTiming;}
  console.info('PHOTO_TIMING '+JSON.stringify({requestId,client,server:serverTiming}));
  if(analysisController===controller){stopAnalysis();updateAnalyzeButton();}
 }

});
$('#garmentForm').addEventListener('submit',async e=>{
 e.preventDefault();if(savingGarment)return;operationLog.event('registration_started',{hasPhoto:!!draftPhoto,hasAnalysis:!!draftVision,hasCutout:!!draftCutout},draftVision?.clientDiagnostics?.requestId);if(!draftReady||analysisController||cutoutController){operationLog.event('registration_rejected');$('#garmentStatus').textContent='사진 처리가 끝난 뒤 등록해주세요.';return;}
 const f=e.currentTarget;const previous=state.closet.find(item=>item.id===editingId);const i={...previous,id:editingId||garmentId(),name:f.elements.name.value.trim(),category:f.elements.category.value,color:f.elements.color.value,...garmentSizing(f.elements.category.value,{fit:f.elements.fit.value,officialSize:f.elements.officialSize.value}),style:f.elements.style.value,warmth:warmthValue(f.elements.warmth.value),formal:f.elements.formal.value===''?null:Number(f.elements.formal.value),comfort:f.elements.comfort.value===''?null:f.elements.comfort.value==='true',available:f.elements.available.checked,officialColor:f.elements.officialColor.value.trim(),url:f.elements.url.value.trim(),photo:draftPhoto,capture:draftCapture,cutout:draftCutout};
 for(const k of ['colorDescription','itemType','pattern','surface','silhouette','lengthDescription'])i[k]=f.elements[k].value.trim();
 Object.assign(i,garmentStyleMetadata(i.style),readGarmentConfirmationFields(f));
 Object.assign(i,thicknessMetadata(i.thickness,{analysis:draftVision?.analysis,previous,edited:editedAnalysisFields.has('thickness')}));
 if(draftVision?.analysis?.attributes?.insulation_visual){const field=draftVision.analysis.attributes.insulation_visual;i.insulationVisual=field.value;i.insulationSource=field.value?'ai_visual':'unknown';i.insulationEvidence=field.evidence?.slice(0,160)||null;}else if(previous?.insulationSource==='ai_visual'&&previous.photo!==draftPhoto){i.insulationVisual=null;i.insulationSource='unknown';i.insulationEvidence=null;}
 if(!i.name||!i.category||!i.color){operationLog.event('registration_rejected');$('#garmentStatus').textContent='옷 이름·종류·근접 색 계열을 확인해주세요.';return;}
 if(draftVision)i.vision={...draftVision,userReview:{status:'confirmed_in_app',confirmedAt:new Date().toISOString(),values:Object.fromEntries(['name','category','color','colorDescription','itemType','pattern','surface','silhouette','lengthDescription','fit','officialSize','officialColor','warmth','formal','style','comfort'].map(k=>[k,i[k]]))}};
 savingGarment=true;$('#saveGarment').disabled=true;const old=[...state.closet];state.closet=state.closet.filter(x=>x.id!==i.id);state.closet.push(i);if(await save()){operationLog.event('registration_finished',{count:state.closet.length},draftVision?.clientDiagnostics?.requestId);skip=0;render();toast('옷장에 기억했어요.');if(photoIndex+1<photoQueue.length){photoIndex++;openGarment(null,{keepQueue:true});await processPhoto(photoQueue[photoIndex]);updateQueueStatus();$('#garmentDialog').scrollTop=0;}else $('#garmentDialog').close();}else{operationLog.event('registration_failed',{},draftVision?.clientDiagnostics?.requestId);state.closet=old;render();$('#garmentStatus').textContent='저장하지 못했어요. 다시 시도해주세요.';}savingGarment=false;$('#saveGarment').disabled=false;
});
$('#weatherExpand').addEventListener('click',()=>$('#weatherForm').hidden=!$('#weatherForm').hidden);

$('#loadWeather').addEventListener('click',()=>refreshWeather());
$('#weatherForm').addEventListener('submit',async e=>{
 e.preventDefault();const a=$('#weatherMin').value,b=$('#weatherMax').value;
 const min=Number(a),max=Number(b),rainValue=$('#weatherRain').value,rain=rainValue===''?null:Number(rainValue);
 if(a===''||b===''||!Number.isFinite(min)||!Number.isFinite(max)||min>max||min< -60||max>60||rain!=null&&(!Number.isFinite(rain)||rain<0||rain>100)){$('#weatherMessage').textContent='최저·최고 기온과 강수 확률을 확인해주세요.';return;}
 const previousWeather={weatherMode:state.weatherMode,weather:state.weather};state.weatherMode='manual';state.weather={date:todayKey(),min,max,rain,snow:$('#weatherSnow').checked,source:'직접 입력',place:checkedRegions('#places').map(cityName).join(' · ')||'확인한 지역'};
 const saved=await save();if(!saved)Object.assign(state,previousWeather);skip=0;resetURLs();renderToday();$('#weatherMessage').textContent=saved?'직접 확인한 날씨를 저장했어요. 서버 추천은 저장된 기상청 예보를 기준으로 해요.':'날씨 저장에 실패해 이전 값을 유지했어요.';
});
$('#purchaseForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget;if(!state.closet.length){$('#purchaseResult').innerHTML='<p class="warning">먼저 보유 옷을 등록하면 함께 입을 조합을 확인할 수 있어요.</p>';return;}
 const candidate={id:'candidate',candidate:true,name:f.elements.name.value.trim(),category:f.elements.category.value,color:f.elements.color.value,fit:f.elements.category.value==='shoe'?'':f.elements.fit.value,formal:Number(f.elements.formal.value),warmth:warmthValue(f.elements.warmth.value),style:f.elements.style.value,...garmentStyleMetadata(f.elements.style.value),comfort:f.elements.comfort.checked,available:true};
 if(!candidate.name){toast('옷 이름을 입력해 주세요.');return;}
 const pool=state.closet.filter(i=>i.category!==candidate.category);const p=recommend([...pool,candidate],state.profile,ctx(),activeWeather(),{requiredId:'candidate'});
 if(!p.outfit||!p.outfit.some(i=>i.id==='candidate')){$('#purchaseResult').innerHTML='<p class="warning">이 후보를 포함한 조합을 만들기에 보유 정보가 부족해요. 필요한 종류: '+esc(p.missing.join(', ')||'함께 입을 옷')+'</p>';return;}
 const fitMatch=candidate.category!=='shoe'&&candidate.fit&&candidate.fit===state.profile.fit;$('#purchaseResult').innerHTML='<h2>기존 옷과 이렇게 조합해볼 수 있어요.</h2><div class="outfit-grid">'+p.outfit.map(itemCard).join('')+'</div><p class="small-text">'+(fitMatch?'선택한 선호 핏과 같은 핏으로 입력됐어요.':'선호 핏과 실제 착용감을 비교해 주세요.')+' 사이즈·소재·실물 색은 구매 전에 확인해 주세요.</p>'+p.notices.map(n=>'<p class="warning">'+esc(n)+'</p>').join('')+'<p class="small-text">후보는 보유 옷장에 추가하지 않았어요. 이 조합은 구매 필요성을 확정하는 평가가 아닙니다.</p>';
});
async function init(){
 const requestedTab=location.hash.slice(1)||'today';
 $('#garmentConfirmationFields').innerHTML=renderGarmentConfirmationFields();try{developerMode=localStorage.getItem('closet-display-mode-v22')==='developer';}catch{}renderDisplayMode();
 const styleCards=moodOptions.map(({id,label,description})=>`<label><input type="checkbox" name="moodPreferences" value="${esc(id)}"><span><b>${esc(label)}</b><small>${esc(description)}</small></span></label>`).join('');
 for(const id of ['#setupStyles','#profileStyles'])$(id).innerHTML=styleCards;
 $$('.style-options').forEach(select=>select.innerHTML='<option value="">잘 모르겠어요 / 선택 안 함</option>'+officialStyleGroups.map(({group,styles})=>`<optgroup label="${esc(group)}">${styles.map(name=>`<option>${esc(name)}</option>`).join('')}</optgroup>`).join(''));

 $$('.color-options').forEach(s=>s.innerHTML=(s.closest('#garmentForm')?'<option value="">선택해 주세요</option>':'')+Object.keys(colors).map(c=>`<option>${c}</option>`).join(''));
 $$('.fit-options').forEach(s=>s.innerHTML=fits.map(f=>`<option>${f}</option>`).join(''));
 $$('.warmth-options').forEach(select=>select.innerHTML=warmthOptions.map(([value,label])=>`<option value="${value}">${label}</option>`).join(''));
 surveyPicker.refresh();
 $('#weekdayChecks').innerHTML=['일','월','화','수','목','금','토'].map((d,i)=>`<label><input type="checkbox" value="${i}">${d}</label>`).join('');
 $('#dateLabel').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());
 setInterval(()=>{if($('#dateLabel').dataset.date!==todayKey()){modifier='';skip=0;comfortReferenceIds=[];$('#dateLabel').dataset.date=todayKey();$('#dateLabel').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());render();refreshHolidays();if(wantsSavedWeather())refreshWeather({quiet:true});}},60000);$('#dateLabel').dataset.date=todayKey();
 try{db=await openDB();mode=await readState('mvp-active-mode')==='demo'?'demo':'real';state=normalizeState(await readState(mode==='demo'?'mvp-demo-v1':'real')||(mode==='demo'?demoState():fresh()));fillRegionChoices('#places',regionIds(state));render();showTab(requestedTab);await refreshHolidays();await loadConfig();if(requestedTab==='cloud'&&cloudUiEnabled)showTab('cloud');}catch{state=fresh();render();toast('브라우저 저장 기능을 사용할 수 없어요. 이 화면의 변경 내용이 저장되지 않을 수 있습니다.');}
}
let holidayPollTimer=null,holidayPollCount=0;
function renderHolidayStatus(c=ctx()){
 const h=c.holiday,names=h?.names?.join(' · '),source=h?.source||'한국천문연구원 특일 정보';
 let text=h?.isHoliday===true?(c.holidayOverride?`${names}이지만 입력한 출근·등교 일정을 우선해요.`:c.remote?`${names} · 입력한 재택 일정을 반영해요.`:`${names} · 오늘은 휴일로 준비해요. 평소 출근·등교와 그 이동 조건을 쉬어갑니다.`):h?.isHoliday===false?'오늘은 등록된 공휴일이 아니에요. 평소 요일 설정을 적용해요.':'오늘의 최신 공휴일 여부를 확인하지 못했어요. 평소 요일 설정을 적용하고, 쉬는 날은 휴가로 알려주세요.';
 if(h?.limited)text+=' 확인된 초기 공휴일 목록만 사용 중이에요. 새 임시공휴일 자동 갱신은 연결 전입니다.';
 else if(h?.stale)text+=' 저장 자료가 오래되어 최신 변경 확인이 필요해요.';
 $('#holidaySummary').textContent=text;
 const upcoming=Object.values(state.holidayCalendar?.years||{}).flatMap(y=>y.holidays||[]).filter(d=>d.date>=todayKey()).sort((a,b)=>a.date.localeCompare(b.date));
 const distinct=[...new Map(upcoming.map(d=>[d.date+'|'+d.name,d])).values()].slice(0,3);
 $('#upcomingHolidays').innerHTML=distinct.length?'<p class="small-text">저장된 다음 공휴일</p>'+distinct.map(d=>`<span class="condition-chip">${esc((d.date.slice(0,4)!==todayKey().slice(0,4)?d.date.slice(0,4)+'년 ':'')+Number(d.date.slice(5,7))+'월 '+Number(d.date.slice(8))+'일')} · ${esc(d.name)}</span>`).join(''):'';
 const failure=state.holidayCalendar?.failures?.[todayKey().slice(0,4)];
 $('#holidayKeyStatus').textContent=state.holidayCalendar?.refreshing?'공식 공휴일 자료를 갱신하고 있어요.':failure==='HOLIDAY_AUTH'?'특일 정보 서비스의 인증키·활용신청을 확인해주세요. 이전에 저장한 공휴일 자료를 사용해요.':failure==='HOLIDAY_KEY_REQUIRED'?'특일 정보 서비스 인증키 연결 전이에요. 확인된 저장 자료만 사용해요.':failure?'새 공휴일 자료를 가져오지 못했어요. 확인된 저장 자료만 적용해요.':`${source} · ${h?.fetchedAt?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'numeric'}).format(new Date(h.fetchedAt))+' 저장':'아직 저장 자료 없음'}`;
}
async function refreshHolidays(){
 try{
  const r=await fetch('/api/holidays',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error();const calendar=await r.json();if(calendar?.version!==1||!calendar.years)throw new Error();
  const changed=JSON.stringify(state.holidayCalendar)!==JSON.stringify(calendar);state.holidayCalendar=calendar;
  if(changed){await save();resetURLs();renderToday();}else renderHolidayStatus();
  if(calendar.refreshing&&holidayPollCount<16&&!holidayPollTimer){holidayPollTimer=setTimeout(()=>{holidayPollTimer=null;holidayPollCount++;refreshHolidays();},2000);}
  else if(!calendar.refreshing||holidayPollCount>=16){clearTimeout(holidayPollTimer);holidayPollTimer=null;holidayPollCount=0;$('#checkHolidayCalendar').disabled=false;}
 }catch{$('#checkHolidayCalendar').disabled=false;renderHolidayStatus();}
}
$('#checkHolidayCalendar').addEventListener('click',async()=>{
 const b=$('#checkHolidayCalendar');b.disabled=true;
 try{clearTimeout(holidayPollTimer);holidayPollTimer=null;holidayPollCount=0;const r=await fetch('/api/holiday-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error();await refreshHolidays();}
 catch{b.disabled=false;$('#holidayKeyStatus').textContent='공휴일 연결 상태를 확인하지 못했어요. 다시 시도해주세요.';}
});
setInterval(()=>{if(state)refreshHolidays();},60*60*1000);

let apiConfig={weatherKeyPresent:false,places:[]};
function renderActions(){
 const plan=weatherPlan(recommendationWeather(),ctx());
 $('#prepareActions').innerHTML=plan.actions.map((text,i)=>`<div class="action-card"><span>${text.includes('우산')||text.includes('강수')?'☂':text.includes('눈')?'❄':'◒'}</span><p>${esc(text)}</p></div>`).join('');
 $('#demoScenarios').hidden=mode!=='demo';
}
function renderMemory(){
 const history=state.history.slice(-7).reverse();
 $('#wearHistory').innerHTML=history.length?history.map(h=>{const f=state.feedback.find(a=>a.date===h.date&&a.ids.join('|')===h.ids.join('|'));return `<p class="history-row"><b>${esc(h.date)}</b><br>${esc((h.names||h.ids.map(id=>state.closet.find(i=>i.id===id)?.name||'이전 등록 옷')).join(' · '))}<br><span class="small-text">${f?.wore?'실제로 입음 · '+({ok:'괜찮았어요',cold:'추웠어요',hot:'더웠어요'}[f.feeling]||''): '입기로 선택한 기록'}</span></p>`;}).join(''):'<p class="small-text">선택한 코디와 입어본 뒤의 피드백이 여기에 남아요.</p>';
 const p=state.profile;const labels=[p.routine,p.exposure==='indoor'?'대부분 실내':p.exposure==='outdoor'?'실외 활동 많음':p.exposure==='mixed'?'실내·실외 혼합':'',p.walking==null?'':p.walking>=30?'걷기 30분 이상':p.walking>=10?'걷기 10분 안팎':'걷기 적음',...temperaturePreferences(p),p.fit,...moodLabels(p)].filter(Boolean);
 $('#learnedMemory').innerHTML=labels.length?labels.map(label=>'<span class="condition-chip">'+esc(label)+'</span>').join(''):'<p class="small-text">초기 설정에서 선택한 생활·취향이 여기에 모여요.</p>';
}
function renderLearning(){
 const selected=state.history.find(h=>h.date===todayKey()),feedback=state.feedback.find(f=>f.date===todayKey()&&f.ids.join('|')===selected?.ids.join('|'));
 $('#wearFeedback').hidden=!selected;
 $('#feedbackSummary').textContent=feedback?.wore?'실제로 입은 뒤의 피드백을 기록했어요.':'입어본 뒤 알려주세요. 선택만으로 착용했다고 판단하지 않아요.';
 $('#feedbackOptions').innerHTML=selected?['ok','cold','hot'].map((v,i)=>`<button class="secondary" data-feeling="${v}">${['입어봤어요 · 괜찮았어요','입어봤어요 · 추웠어요','입어봤어요 · 더웠어요'][i]}</button>`).join(''):'';
}
async function loadConfig(){
 try{const r=await fetch('/api/config');if(!r.ok)throw new Error();apiConfig=await r.json();updateCutoutButton();await configureCloudFromServer();$('#cloudServerStatus').textContent=apiConfig.supabase?.enabled?'앱 서버의 클라우드 저장 대상: '+(apiConfig.supabase.url||'주소 미확인'):'앱 서버의 클라우드 저장은 아직 연결 전이에요. 현재 옷장은 이 브라우저에 보관됩니다.';for(const sel of ['#places','#setupLocations','#profileLocations'])fillRegionChoices(sel,regionChoosers.has(sel)?checkedRegions(sel):regionIds(state));$('#keyStatus').textContent=apiConfig.weatherKeyPresent?'날씨 서비스가 설정되어 있어요. 지역을 선택하면 실제 예보를 확인할 수 있어요.':'.env 파일에 인증키를 넣고 저장해주세요. 인증키가 아직 비어 있어요.';if(wantsSavedWeather())await refreshWeather({quiet:true});}
 catch{$('#keyStatus').textContent='연결 설정을 읽지 못했어요. 화면을 다시 열어주세요.';}
}
const weatherVersion=w=>JSON.stringify([w?.requestedPlaceIds,w?.missingPlaces,(w?.forecasts||[w]).map(f=>[f?.placeId,f?.date,f?.min,f?.max,f?.rain,f?.snow,f?.hourly,f?.stale])]);
async function refreshWeather({quiet=false}={}){
 if($('#loadWeather').disabled)return;
 const ids=quiet?regionIds(state):checkedRegions('#places');if(!ids.length){if(!quiet){$('#weatherMessage').textContent='활동할 지역을 하나 이상 선택해주세요.';}return;}const requestRevision=++weatherRevision;
 const requestedState=state;
 $('#loadWeather').disabled=true;if(!quiet)$('#weatherMessage').textContent='저장된 예보를 확인하고 있어요…';
 const regions=new Set(ids);
 const regionKey=[...regions].join(',');
 try{
  if(!quiet||registeredRegionKey!==regionKey){
   const registration=await fetch('/api/weather-regions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({places:[...regions],retry:!quiet})});
   if(!registration.ok)throw new Error((await registration.json()).error);
   if(requestedState!==state||requestRevision!==weatherRevision)return;
   registeredRegionKey=regionKey;state.locationIds=ids;state.locationId=ids[0];state.weatherMode='saved';await save();
  }
  const r=await fetch('/api/weather?'+new URLSearchParams({places:regionKey})),weather=await r.json();if(requestedState!==state||requestRevision!==weatherRevision)return;
  if(r.status===202){
   resetURLs();renderToday();$('#weatherMessage').textContent=weather.error;
   clearTimeout(weatherRetryTimer);weatherRetryTimer=setTimeout(()=>{if(state===requestedState&&!document.hidden)refreshWeather({quiet:true});},1500);return;
  }
  if(!r.ok)throw new Error(weather.error);if(weather.date!==todayKey())throw new Error('오늘 예보가 아니에요. 다시 확인해주세요.');
  const sameWeather=weatherVersion(state.weather)===weatherVersion(weather);state.weather=weather;await save();
  if(quiet&&sameWeather)renderWeatherSummary();else{skip=0;resetURLs();renderToday();}
  $('#weatherMessage').textContent=weather.missingPlaces?.length?weather.missingPlaces.join(', ')+' 예보는 아직 확인되지 않았어요.':weather.forecasts?.some(f=>f.stale)?'저장된 이전 예보를 사용하고 있어요. 최신화 상태와 받은 시각을 확인해주세요.':'저장된 기상청 예보를 반영했어요. 새 발표 자료는 미리 수집해 갱신해요.';
 }catch(error){
  if(requestedState!==state||requestRevision!==weatherRevision)return;
  if(!quiet||!activeWeather()){resetURLs();renderToday();}
  $('#weatherMessage').textContent=error instanceof TypeError?'앱의 날씨 저장소에 연결하지 못했어요. 잠시 후 다시 확인해주세요.':error.message||'예보를 확인하지 못했어요.';
 }finally{$('#loadWeather').disabled=false;if(requestedState===state&&requestRevision!==weatherRevision&&regionIds(state).length)queueMicrotask(()=>refreshWeather({quiet:true}));}
}
$('#checkWeatherConfig').addEventListener('click',()=>loadConfig());
document.addEventListener('click',async e=>{
 const quick=e.target.closest('[data-quick]');if(quick){const words=$('#schedule').value.split(' / ').filter(Boolean),word=quick.dataset.quick;const next=words.includes(word)?words.filter(w=>w!==word):[...words,word];$('#schedule').value=next.join(' / ');$('#applySchedule').click();}
 const feedback=e.target.closest('[data-feeling]');if(feedback){const selected=state.history.find(h=>h.date===todayKey());if(!selected)return;const previousFeedback=state.feedback;state.feedback=state.feedback.filter(f=>f.date!==todayKey());state.feedback.push({date:todayKey(),wore:true,feeling:feedback.dataset.feeling,season:feedbackSeason(activeWeather()),ids:[...selected.ids]});const saved=await save();if(!saved)state.feedback=previousFeedback;renderToday();renderLearning();renderMemory();if(saved)toast('입어본 뒤의 느낌을 기록했어요. 한 번의 답으로 취향을 바꾸지 않아요.');}
 const scenario=e.target.closest('[data-scenario]');if(scenario&&mode==='demo'){
  const previousScenario={profile:{...state.profile},schedule:state.schedule,weatherMode:state.weatherMode,weather:state.weather};const type=scenario.dataset.scenario;state.profile.cooling=type==='hot';state.profile.heating=type==='cold';
  state.schedule={date:todayKey(),text:type==='rain'?'출근 후 저녁 약속':type==='cold'?'출근':'출근 / 실내 냉방'};
  state.weatherMode='example';state.weather={date:todayKey(),place:'서울 · 예시',source:'예시 날씨',min:type==='cold'?-3:type==='hot'?26:18,max:type==='cold'?6:type==='hot'?33:24,rain:type==='rain'?80:0,snow:type==='cold',hourly:[8,9,12,15,18,19,20,21].map(hour=>({hour,temp:type==='cold'?(hour<10?-1:4):type==='hot'?(hour<10?27:33):hour>17?20:24,rain:type==='rain'&&hour>17?80:0,pty:type==='cold'?3:type==='rain'&&hour>17?1:0,wind:2}))};
  modifier='';skip=0;comfortReferenceIds=[];const saved=await save();if(!saved)Object.assign(state,previousScenario);render();if(saved)toast('예시 생활 조건을 바꿨어요. 서버 추천은 저장된 기상청 예보를 기준으로 해요.');
 }
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&wantsSavedWeather())refreshWeather({quiet:true});});
setInterval(()=>{if(!document.hidden&&wantsSavedWeather())refreshWeather({quiet:true});},60000);


function checkedRegions(selector){return [...document.querySelectorAll(selector+' input:checked')].map(el=>el.value);}
const regionChoosers=new Map();
function fillRegionChoices(selector,chosen){if(!regionChoosers.has(selector))regionChoosers.set(selector,createRegionChooser($(selector),{refresh:()=>surveyPicker.refresh()}));regionChoosers.get(selector).setSelected(chosen);}
function fillTemperatures(selector,chosen){$$(selector+' input[name="sensitivities"]').forEach(el=>el.checked=chosen.includes(el.value));}
document.addEventListener('change',e=>{if(e.target.matches('input[name="sensitivities"]')&&e.target.checked){const form=e.target.closest('form');for(const other of form.querySelectorAll('input[name="sensitivities"]'))if(e.target.value==='보통'&&other.value!=='보통'||e.target.value!=='보통'&&other.value==='보통')other.checked=false;}});

let setupStep=0;
function setupInput(){const data=new FormData($('#setupForm'));return {...Object.fromEntries(data),days:data.getAll('days'),moodPreferences:data.getAll('moodPreferences'),locationIds:data.getAll('locationIds'),sensitivities:data.getAll('sensitivities')};}
function renderSetupStep(focus=false){
 $$('#setupForm [data-setup-step]').forEach(el=>el.hidden=Number(el.dataset.setupStep)!==setupStep);
 $('#setupProgress').textContent=(setupStep+1)+' / 3 · '+['평소 생활','이동과 온도','핏과 느낌'][setupStep];
 $$('.setup-progress span').forEach((el,i)=>el.classList.toggle('done',i<=setupStep));
 $('#setupBack').hidden=setupStep===0;$('#setupNext').textContent=setupStep===2?'저장하고 옷 등록하기':'다음';
 if(focus)$('#setupForm [data-setup-step="'+setupStep+'"] h2').focus();
}
function fillSetup(){
 const f=$('#setupForm'),p=state.profile,d=state.onboarding?.draft;
 $('#setupDays').innerHTML=['일','월','화','수','목','금','토'].map((day,i)=>'<label><input type="checkbox" name="days" value="'+i+'">'+day+'</label>').join('');
 f.reset();const source=d||{...p,locationIds:regionIds(state)};fillRegionChoices('#setupLocations',regionIds(source));fillTemperatures('#setupForm',temperaturePreferences(source));
 for(const key of ['routine','dressCode','walking','exposure','fit'])f.elements[key].value=source[key]??'';
 for(const key of ['cooling','heating'])f.elements[key].value=source[key]==null?'':String(source[key]);
 // A new user has not answered any values, even if the legacy blank profile has defaults.
 if(!d&&!state.onboarding?.completedAt&&!state.closet.length&&!state.answers.length&&mode==='real')for(const key of ['dressCode','walking','exposure','cooling','heating'])f.elements[key].value='';
 $$('#setupDays input').forEach(el=>el.checked=(source.days||[]).map(Number).includes(Number(el.value)));
 const moods=moodPreferences(source);$$('#setupForm input[name="moodPreferences"]').forEach(el=>el.checked=moods.includes(el.value));
 setupStep=Math.min(2,Math.max(0,Number(state.onboarding?.step)||0));surveyPicker.refresh();renderSetupStep();
}
$('#setupBack').addEventListener('click',async()=>{
 state.onboarding={...state.onboarding,draft:setupInput(),step:Math.max(0,setupStep-1)};
 if(await save()){setupStep=state.onboarding.step;renderSetupStep(true);}
});
$('#setupForm').addEventListener('submit',async e=>{
 e.preventDefault();$('#setupNext').disabled=true;
 try{
  const input=setupInput();
  if(setupStep===0&&input.routine&&!input.days.length){$('#setupStatus').textContent='반복되는 활동이면 요일도 선택해주세요. 정해진 요일이 없다면 활동을 아직 모름으로 두실 수 있어요.';return;}
  if(setupStep<2){state.onboarding={...state.onboarding,draft:input,step:setupStep+1};if(await save()){setupStep++;renderSetupStep(true);$('#setupStatus').textContent='선택 내용을 저장했어요. 모르는 항목은 그대로 넘어가세요.';}return;}
  const previous={profile:state.profile,locationId:state.locationId,locationIds:state.locationIds,onboarding:state.onboarding};const result=setupResult(input,state.profile);Object.assign(state,result);
  if(!await save()){Object.assign(state,previous);$('#setupStatus').textContent='저장하지 못했어요. 설정은 아직 완료되지 않았습니다. 다시 시도해주세요.';return;}
  modifier='';skip=0;comfortReferenceIds=[];registeredRegionKey='';weatherRevision++;fillRegionChoices('#places',regionIds(state));render();showTab('closet');toast('처음 설정을 기억했어요. 이제 자주 입는 옷을 등록해주세요.');
  if(regionIds(state).length&&apiConfig.weatherKeyPresent)refreshWeather({quiet:true});
 }finally{$('#setupNext').disabled=false;}
});
const surveyPicker=installSurveyPicker();
init().then(()=>operationLog.event('app_ready')).catch(error=>{operationLog.event('runtime_error',{errorName:error.name});operationLog.flush();throw error;});



refreshGeminiBudget();
document.addEventListener("click",e=>{if(e.target.closest("#openGarment,[data-edit]"))refreshGeminiBudget();});
