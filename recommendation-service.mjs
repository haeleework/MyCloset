import {emptyRecommendationResponse} from './recommendation-contract.js';
import {createRuleRecommendations} from './recommendation-rules.js';
import {contexts} from './engine.js';

export class RecommendationError extends Error {
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\x00-\x1f]/.test(v);
export function validateRecommendationRequest(input){
 if(!object(input)||!validId(input.requestId)||!['string','number'].includes(typeof input.wardrobeRevision)||String(input.wardrobeRevision).length>180||!Array.isArray(input.wardrobe)||input.wardrobe.length>2000||!object(input.profile)||!object(input.context))throw new RecommendationError('INVALID_RECOMMENDATION_REQUEST');
 const ids=new Set();
 for(const item of input.wardrobe){
  if(!object(item)||!validId(item.id)||ids.has(item.id)||!['top','bottom','dress','shoe','outer'].includes(item.category))throw new RecommendationError('INVALID_WARDROBE');
  ids.add(item.id);
 }
 const options=input.options??{};
 if(!object(options)||!['','comfort','formal'].includes(options.modifier??'')||options.topK!=null&&(!Number.isInteger(options.topK)||options.topK<1||options.topK>5)||options.skip!=null&&(!Number.isInteger(options.skip)||options.skip<0||options.skip>100000)||options.requiredId!=null&&!ids.has(options.requiredId)||options.referenceIds!=null&&(!Array.isArray(options.referenceIds)||options.referenceIds.length>5||options.referenceIds.some(id=>!ids.has(id)))||options.history!=null&&(!Array.isArray(options.history)||options.history.length>100))throw new RecommendationError('INVALID_RECOMMENDATION_OPTIONS');
 return input;
}
/** All external dependencies are injected. Production uses the authenticated
 * repository and saved forecast provider. Local mode never claims DB ownership.
 * Client weather/scores/roles are ignored; profile/context are preference input.
 */
export function createRecommendationService({weatherProvider=async()=>({weather:null,warnings:['저장된 기상청 예보를 아직 확인하지 못했어요.']}),gemini=null,repository=null,mode='local',rules=createRuleRecommendations,ruleConfig={},maxConcurrent=4}={}){
 let active=0;
 return {mode,async recommend(raw,{accessToken=null}={}){
  const started=performance.now();validateRecommendationRequest(raw);
  if(active>=maxConcurrent)throw new RecommendationError('RECOMMENDATION_BUSY',429);
  active++;
  try{
   let wardrobe=raw.wardrobe,userId='local';
   if(mode==='supabase'){
    if(!repository)throw new RecommendationError('REPOSITORY_NOT_CONFIGURED',503);
    if(!accessToken)throw new RecommendationError('AUTH_REQUIRED',401);
    const owned=await repository.resolveGarments({accessToken,garmentIds:wardrobe.map(i=>i.id)});
    wardrobe=owned.wardrobe;userId=owned.user.id;
    if(wardrobe.length!==raw.wardrobe.length||new Set(wardrobe.map(i=>i.id)).size!==raw.wardrobe.length||wardrobe.some(i=>!raw.wardrobe.some(j=>j.id===i.id)))throw new RecommendationError('WARDROBE_OWNERSHIP_MISMATCH',403);
   }
   const context=contexts(raw.profile,String(raw.context.text??'').slice(0,4000),raw.context.date,Array.isArray(raw.context.events)?raw.context.events:[],raw.context.holiday);
   // Explicit user-entered context is a preference, never an authorization claim.
   for(const k of ['formal','walking','cooling','heating','exposure','sensitive','sensitivities','warmthBias','routine','remote'])if(raw.context[k]!=null)context[k]=raw.context[k];
   for(const k of ['locationIds','placeIds'])if(Array.isArray(raw.context[k]))context[k]=raw.context[k].filter(v=>typeof v==='string').slice(0,8);
   for(const k of ['locationId','placeId'])if(typeof raw.context[k]==='string')context[k]=raw.context[k];
   const options={modifier:raw.options?.modifier??'',skip:raw.options?.skip??0,history:raw.options?.history??[],requiredId:raw.options?.requiredId??null,referenceIds:raw.options?.referenceIds??[],topK:raw.options?.topK??5,ruleConfig};
   let weatherResult;const weatherStart=performance.now();
   try{weatherResult=await weatherProvider({profile:raw.profile,context});}catch{weatherResult={weather:null,warnings:['저장된 기상청 예보를 읽지 못했어요. 날씨를 확인해주세요.']};}
   const weatherReadMs=performance.now()-weatherStart;
   const ruleResult=await rules(wardrobe,raw.profile,context,weatherResult?.weather??null,options);
   const response={...emptyRecommendationResponse(raw),...ruleResult,requestId:raw.requestId,wardrobeRevision:raw.wardrobeRevision,source:'rules'};
   response.weather={...emptyRecommendationResponse().weather,...(ruleResult.weather??{}),...(weatherResult?.summary??{})};
   response.warnings=[...(weatherResult?.warnings??[]),...(ruleResult.warnings??[])];
   response.missing=ruleResult.legacyResult?.missing??[];
   response.validCandidateCount=ruleResult.legacyResult?.total??response.looks.length;
   if(ruleResult.legacyResult?.comfortAdjustment)response.comfortAdjustment=ruleResult.legacyResult.comfortAdjustment;
   if(ruleResult.formalAdjustment)response.formalAdjustment=ruleResult.formalAdjustment;
   delete response.legacyResult;
   response.weather.providerCalled=weatherResult?.providerCalled??null;
   response.diagnostics={...emptyRecommendationResponse().diagnostics,...ruleResult.diagnostics,storage:{mode,ownershipVerified:mode==='supabase'},timingsMs:{...emptyRecommendationResponse().diagnostics.timingsMs,...weatherResult?.timingsMs,weatherCacheRead:weatherResult?.timingsMs?.weatherCacheRead??weatherReadMs},gemini:emptyRecommendationResponse().diagnostics.gemini};
   response.diagnostics.weatherProviderCalled=weatherResult?.providerCalled??null;
   // Alternative/comfort/formal actions must keep their deterministic selection.
   if(gemini&&response.looks.length&&options.skip===0&&!options.modifier){
    const aiContext={...context,temperatureMin:response.weather.temperatureMin,temperatureMax:response.weather.temperatureMax,humidity:response.weather.humidity};
    let result;
    try{result=await gemini.recommend({looks:response.looks,wardrobe,profile:raw.profile,context:aiContext,userId});}
    catch{result={source:'rules',looks:response.looks,gemini:{called:false,attempted:false,reason:'RECOMMENDER_FAILED',usage:null}};response.warnings.push('AI 추천을 확인하지 못해 규칙 추천을 유지했어요.');}
    const meta=result.gemini??{};
    response.diagnostics.gemini={called:meta.attempted??false,cached:meta.cacheHit??false,model:meta.model??null,usage:meta.usage??null,...meta};
    response.diagnostics.timingsMs.gemini=meta.durationMs??null;
    if(result.source==='gemini'){
     const known=new Map(response.looks.map(l=>[l.candidateId,l]));
     const proposed=result.looks??[];
     if(proposed.length===known.size&&new Set(proposed.map(l=>l.candidateId)).size===known.size&&proposed.every(l=>known.has(l.candidateId))){
      response.looks=proposed.map(l=>({...known.get(l.candidateId),stylingTip:l.stylingTip??l.tip??known.get(l.candidateId).stylingTip}));
      response.source='gemini';response.selectedLookId=response.looks[0].candidateId;
     }else response.warnings.push('AI 후보 검증에 실패해 규칙 추천을 유지했어요.');
    }
   }
   const selected=response.looks.find(l=>l.candidateId===response.selectedLookId);
   response.warnings=[...new Set([...response.warnings,...(selected?.notices??[])])];
   response.diagnostics.timingsMs.server=performance.now()-started;
   return response;
  }finally{active--;}
 }};
}
