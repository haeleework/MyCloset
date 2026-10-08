import {budgetPolicy,attemptReserveMicroWon,usageCost} from '../budget-cost.mjs';
const budgetKey='mycloset-shared-2026-10-07';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function createBudgetBridge({secretHash,endpoint,serviceKey,fetchImpl=fetch,now=()=>new Date()}){
 return async req=>{
  if(req.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  const token=req.headers.get('X-Closet-Budget-Key')||'';
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  if(!secretHash||token.length<32||digest!==secretHash)return reply(401,{code:'UNAUTHORIZED'});
  try{
   const reader=req.body.getReader();let bytes=0,parts=[];
   while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();return reply(413,{code:'TOO_LARGE'});}parts.push(value);}
   const input=JSON.parse(await new Blob(parts).text());let rpc,args;
   if(input.op==='snapshot'){rpc='closet_ai_budget_snapshot';args={p_budget_key:budgetKey};}
   else if(input.op==='reserve'&&uuid.test(input.id)&&['photo-analysis','text-recommendation'].includes(input.purpose)){
    if(now().toISOString().slice(0,10)>=budgetPolicy.priceValidBefore)return reply(503,{code:'BUDGET_PRICE_EXPIRED'});
    rpc='closet_reserve_ai';args={p_request_key:input.id,p_budget_key:budgetKey,p_user_id:null,p_purpose:input.purpose,p_reserved_won:attemptReserveMicroWon/1e6};
   }else if(input.op==='finish'&&uuid.test(input.id)){
    const cost=usageCost(input.usage),unbilled=input.httpStatus===400||input.httpStatus===500;
    rpc='closet_settle_ai';args={p_request_key:input.id,p_charged_won:cost?cost.estimatedMicroWon/1e6:unbilled?0:attemptReserveMicroWon/1e6,p_usage:{usd:cost?.usd??0,inputTokens:cost?.inputTokens??null,outputTokens:cost?.outputTokens??null,httpStatus:input.httpStatus??null},p_uncertain:!cost&&!unbilled};
   }else return reply(400,{code:'INVALID_INPUT'});
   const headers={'Content-Type':'application/json',apikey:serviceKey};
   if(!serviceKey.startsWith('sb_secret_'))headers.Authorization='Bearer '+serviceKey;
   const res=await fetchImpl(endpoint+'/rest/v1/rpc/'+rpc,{method:'POST',redirect:'error',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
   const result=await res.json();
   if(!res.ok)return reply(503,{code:/BUDGET_EXCEEDED/i.test(result.message||'')?'TEST_BUDGET_LIMIT':'BUDGET_UNAVAILABLE'});
   if(!result)return reply(503,{code:'BUDGET_UNAVAILABLE'});
   return reply(200,result);
  }catch{return reply(503,{code:'BUDGET_UNAVAILABLE'});}
 };
}
