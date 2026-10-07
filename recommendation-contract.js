/** v22 browser/server shared contract. POST /api/recommendations, same origin JSON.
 * Request: {requestId, wardrobeRevision, wardrobe, profile, context,
 * options:{modifier,skip,history,requiredId,referenceIds,topK:5}}.
 * All original garment/profile/context fields remain supported. Optional structured
 * attributes: material, materialConfirmed, thickness, length, colorFamily,
 * colorLightness, colorChroma, colorHue (unknown must remain null).
 * Server resolves candidateId -> itemIds; client never supplies scores/authority.
 * Browser imports only this module; createRecommendationService is server-only.
 * Server: createRecommendationService({weatherProvider,gemini,repository,mode,
 * ruleConfig}).recommend(request,{accessToken}); createAppServer({recommendations}).
 * v22 default launch: PORT=4331, CLOSET_TEST_MODE=1. Gemini remains disabled
 * unless CLOSET_ENABLE_GEMINI=1 AND test mode is off. npm test blocks all outbound
 * networks (loopback mock servers allowed). No change to the existing 4317 app.
 * Additions: validCandidateCount, missing, comfortAdjustment, formalAdjustment,
 * diagnostics.search and climatePolicy. Weather comes from server cache only;
 * context.locationIds chooses cache regions, never client weather observations.
 */
export const RECOMMENDATION_CONTRACT_VERSION='22.1';
export const RECOMMENDATION_ENDPOINT='/api/recommendations';
export const RECOMMENDATION_TOP_K=5;
export function emptyRecommendationResponse(request={}) {
 return {requestId:request.requestId??null,wardrobeRevision:request.wardrobeRevision??null,
 source:'rules',selectedLookId:null,
 weather:{kind:'forecast',temperatureMin:null,temperatureMax:null,humidity:null,issuedAt:null,fetchedAt:null,cached:false,stale:null},
 looks:[],diagnostics:{candidatesGenerated:0,candidatesAfterFilter:0,topKCount:0,excludedCounts:{},timingsMs:{server:null,weatherCacheRead:null,weatherProvider:null,gemini:null},gemini:{called:false,cached:false,model:null,usage:null}},warnings:[]};
}
