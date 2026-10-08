// Conservative local estimates, not the Google billing-account balance.
export const budgetPolicy=Object.freeze({model:'gemini-3.8-flash',capWon:5000,inputUsdPerMillion:0.75,outputUsdPerMillion:3.75,wonPerUsd:2000,safetyMultiplier:1.2,priceValidBefore:'2027-01-01',inputTokenCeiling:1048576,outputTokenCeiling:65536});
const micro=1e6;
const safeCount=n=>Number.isSafeInteger(n)&&n>=0;
export function usageCost(usage){
 if(!usage||!safeCount(usage.promptTokenCount)||!safeCount(usage.candidatesTokenCount)||!safeCount(usage.thoughtsTokenCount??0)||!safeCount(usage.totalTokenCount))return null;
 const inputTokens=usage.promptTokenCount,outputTokens=Math.max(usage.totalTokenCount-inputTokens,usage.candidatesTokenCount+(usage.thoughtsTokenCount||0));
 if(inputTokens>budgetPolicy.inputTokenCeiling||outputTokens>budgetPolicy.outputTokenCeiling||outputTokens<0||usage.totalTokenCount<inputTokens)return null;
 const usd=(inputTokens*budgetPolicy.inputUsdPerMillion+outputTokens*budgetPolicy.outputUsdPerMillion)/1e6;
 return {inputTokens,outputTokens,usd,estimatedMicroWon:Math.ceil(usd*budgetPolicy.wonPerUsd*budgetPolicy.safetyMultiplier*micro)};
}
// Reserve the entire model context/output ceiling before sending. Typical photos
// use much less; settle with returned usage, including thinking tokens.
export const attemptReserveMicroWon=Math.ceil(((budgetPolicy.inputTokenCeiling*budgetPolicy.inputUsdPerMillion+budgetPolicy.outputTokenCeiling*budgetPolicy.outputUsdPerMillion)/1e6)*budgetPolicy.wonPerUsd*budgetPolicy.safetyMultiplier)*micro;
