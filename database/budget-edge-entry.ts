import {createBudgetBridge} from './budget-bridge.mjs';
// Deployment substitutes only a SHA-256 digest, never the actual bridge credential.
const secretHash='__SERVER_TOKEN_SHA256__';
let keys={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');}catch{}
Deno.serve(createBudgetBridge({secretHash,endpoint:Deno.env.get('SUPABASE_URL'),serviceKey:keys['default']||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
