import {randomUUID} from 'node:crypto';
import {budgetPolicy,attemptReserveMicroWon,BudgetError} from './gemini-budget.mjs';

// Both local and cloud use one atomic database account. Never fall back to a new ledger.
export class SharedGeminiBudget {
 constructor({url,token,purpose='photo-analysis',fetchImpl=globalThis.fetch,now=()=>new Date()}={}) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!token||token.length<32)throw new BudgetError('BUDGET_UNAVAILABLE');
  Object.assign(this,{url,token,purpose,fetchImpl,now});
 }
 async call(input) {
  try {
   const response=await this.fetchImpl(this.url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Closet-Budget-Key':this.token},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
   const result=await response.json();
   if(!response.ok)throw new BudgetError(['TEST_BUDGET_LIMIT','BUDGET_PRICE_EXPIRED'].includes(result.code)?result.code:'BUDGET_UNAVAILABLE');
   return result;
  }catch(error){if(error instanceof BudgetError)throw error;throw new BudgetError('BUDGET_UNAVAILABLE');}
 }
 async snapshot(){
  const s=await this.call({op:'snapshot'});
  if(![s.capWon,s.estimatedUsedWon,s.reservedWon,s.generationAttempts,s.knownUsageUsd,s.uncertainAttempts].every(n=>Number.isFinite(n)&&n>=0)||s.capWon!==budgetPolicy.capWon)throw new BudgetError('BUDGET_UNAVAILABLE');
  const availableWon=Math.max(0,s.capWon-s.estimatedUsedWon-s.reservedWon);
  return {...s,scope:'로컬·배포본이 함께 기록한 앱 호출',availableWon,canRequest:availableWon>=attemptReserveMicroWon/1e6&&this.now().toISOString().slice(0,10)<budgetPolicy.priceValidBefore,policy:budgetPolicy};
 }
 async reserve(){
  if(this.now().toISOString().slice(0,10)>=budgetPolicy.priceValidBefore)throw new BudgetError('BUDGET_PRICE_EXPIRED');
  const id=randomUUID();await this.call({op:'reserve',id,purpose:this.purpose});return id;
 }
 async finish(id,usage,{httpStatus}={}){return this.call({op:'finish',id,usage,httpStatus});}
 async close(){}
}
