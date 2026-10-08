import {mkdir,readFile,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {budgetPolicy,usageCost,attemptReserveMicroWon} from './budget-cost.mjs';
export {budgetPolicy,usageCost,attemptReserveMicroWon};
export class BudgetError extends Error{constructor(code){super(code);this.code=code;this.status=503;}}
const micro=1e6;const safeCount=n=>Number.isSafeInteger(n)&&n>=0;
export class GeminiBudget{
 constructor(dir,{capWon=budgetPolicy.capWon,now=()=>new Date()}={}){
  if(!Number.isSafeInteger(capWon)||capWon<=0||capWon>5000)throw new BudgetError('BUDGET_UNAVAILABLE');
  this.dir=dir;this.file=path.join(dir,'usage.ndjson');this.lockFile=path.join(dir,'owner.lock');this.capMicro=capWon*micro;this.now=now;this.pending=new Map();this.finished=new Set();this.committed=0;this.knownUsd=0;this.calls=0;this.uncertain=0;this.queue=Promise.resolve();this.failed=false;this.lock=null;
  this.ready=this.init();this.ready.catch(()=>{});
 }
 async init(){
  let initializing=null;
  const initializingFile=path.join(this.dir,'initializing.lock');
  try{
   await mkdir(this.dir,{recursive:true});initializing=await open(initializingFile,'wx');
   try{this.lock=await open(this.lockFile,'wx');}catch(e){
    if(e.code!=='EEXIST')throw e;
    const ownerText=await readFile(this.lockFile,'utf8');if(!/^[1-9][0-9]*$/.test(ownerText))throw e;
    let dead=false;try{process.kill(Number(ownerText),0);}catch(check){if(check.code==='ESRCH')dead=true;}
    if(!dead)throw e;
    // Only this startup can recover a dead owner. Live or unreadable owners block.
    // Unresolved reservations in the ledger remain charged after recovery.
    await unlink(this.lockFile);this.lock=await open(this.lockFile,'wx');
   }
   await this.lock.writeFile(String(process.pid));
   let content;try{content=await readFile(this.file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;const f=await open(this.file,'wx');try{await f.writeFile(JSON.stringify({type:'policy',version:1,capMicro:this.capMicro,policy:budgetPolicy})+'\n');await f.sync();}finally{await f.close();}content=await readFile(this.file,'utf8');}
   const rows=content.trim().split('\n').map(JSON.parse),head=rows.shift();
   if(head?.type!=='policy'||head.version!==1||head.capMicro!==this.capMicro||JSON.stringify(head.policy)!==JSON.stringify(budgetPolicy))throw new Error('Invalid policy');
   for(const row of rows)this.apply(row);
  }catch{this.failed=true;throw new BudgetError('BUDGET_UNAVAILABLE');}
  finally{if(initializing){await initializing.close();await unlink(initializingFile);}}
 }
 apply(row){
  if(row.type==='reserve'){
   if(typeof row.id!=='string'||this.pending.has(row.id)||this.finished.has(row.id)||row.microWon!==attemptReserveMicroWon)throw new Error('Invalid reservation');
   this.pending.set(row.id,row.microWon);this.calls++;
  }else if(row.type==='finish'){
   if(!this.pending.has(row.id)||!safeCount(row.microWon)||row.microWon>this.pending.get(row.id)||!Number.isFinite(row.usd)||row.usd<0||typeof row.uncertain!=='boolean')throw new Error('Invalid cost');
   this.pending.delete(row.id);this.finished.add(row.id);this.committed+=row.microWon;this.knownUsd+=row.usd;if(row.uncertain)this.uncertain++;
  }else throw new Error('Invalid ledger');
 }
 run(work){const task=this.queue.then(async()=>{await this.ready;if(this.failed)throw new BudgetError('BUDGET_UNAVAILABLE');return work();});this.queue=task.catch(()=>{});return task;}
 async append(row){
  try{const f=await open(this.file,'a');try{await f.writeFile(JSON.stringify({...row,at:this.now().toISOString()})+'\n');await f.sync();}finally{await f.close();}this.apply(row);}catch{this.failed=true;throw new BudgetError('BUDGET_UNAVAILABLE');}
 }
 reserved(){return [...this.pending.values()].reduce((n,v)=>n+v,0);}
 state(){return {scope:'이 앱에서 기록한 테스트 호출만',capWon:this.capMicro/micro,estimatedUsedWon:this.committed/micro,reservedWon:this.reserved()/micro,availableWon:Math.max(0,(this.capMicro-this.committed-this.reserved())/micro),knownUsageUsd:this.knownUsd,generationAttempts:this.calls,uncertainAttempts:this.uncertain+this.pending.size,canRequest:this.capMicro-this.committed-this.reserved()>=attemptReserveMicroWon,policy:budgetPolicy};}
 snapshot(){return this.run(()=>this.state());}
 reserve(){return this.run(async()=>{
  if(this.now().toISOString().slice(0,10)>=budgetPolicy.priceValidBefore)throw new BudgetError('BUDGET_PRICE_EXPIRED');
  if(this.capMicro-this.committed-this.reserved()<attemptReserveMicroWon)throw new BudgetError('TEST_BUDGET_LIMIT');
  const id=randomUUID();await this.append({type:'reserve',id,microWon:attemptReserveMicroWon});return id;
 });}
 finish(id,usage,{httpStatus}={}){return this.run(async()=>{
  const cost=usageCost(usage);
  // Only explicitly documented unbilled error codes are released. Network
  // cancellation, timeouts, missing usage and other failures retain the ceiling.
  const unbilled=httpStatus===400||httpStatus===500;
  await this.append({type:'finish',id,microWon:cost?.estimatedMicroWon??(unbilled?0:attemptReserveMicroWon),usd:cost?.usd??0,uncertain:!cost&&!unbilled,inputTokens:cost?.inputTokens??null,outputTokens:cost?.outputTokens??null,httpStatus:httpStatus??null});
  return this.state();
 });}
 async close(){await this.queue;try{await this.ready;}catch{}if(this.lock){await this.lock.close();this.lock=null;await unlink(this.lockFile);}}
}
