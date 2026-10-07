import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSupabaseWardrobeRepository,garmentMetadata} from './wardrobe-repository.mjs';
const userId='12345678-1234-4234-8234-123456789abc';
const row=(id='g1',owner=userId)=>({id,user_id:owner,attributes:{name:'흰 셔츠',category:'top',color:'화이트',warmth:null}});
function repository(handler){const calls=[];return {calls,repo:createSupabaseWardrobeRepository({enabled:true,url:'https://example.supabase.co',publishableKey:'sb_publishable_test',fetchImpl:async(url,options)=>{calls.push({url,options});const payload=url.includes('/auth/v1/user')?{id:userId,user_metadata:{role:'admin'}}:await handler(url,options);return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});}})};}
test('disabled repository and secret key configurations make no calls',async()=>{
 let calls=0;await assert.rejects(createSupabaseWardrobeRepository({fetchImpl:()=>calls++}).authenticate('token'),{code:'SUPABASE_NOT_CONFIGURED'});
 for(const key of ['sb_secret_bad','x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'])assert.throws(()=>createSupabaseWardrobeRepository({enabled:true,url:'https://example.supabase.co',publishableKey:key}),{code:'SUPABASE_PUBLISHABLE_KEY_REQUIRED'});assert.equal(calls,0);
});
test('resolve validates auth on server then resolves only owned IDs in requested order',async()=>{
 const {repo,calls}=repository(()=>[row('g2'),row('g1')]);const result=await repo.resolveGarments({accessToken:'test-token',garmentIds:['g1','g2']});assert.deepEqual(result.user,{id:userId});assert.deepEqual(result.wardrobe.map(v=>v.id),['g1','g2']);assert.match(calls[0].url,/\/auth\/v1\/user$/);const query=new URL(calls[1].url).searchParams;assert.equal(query.get('user_id'),'eq.'+userId);assert.equal(query.get('id'),'in.(g1,g2)');assert.equal(calls[1].options.headers.Authorization,'Bearer test-token');assert.equal(calls[1].options.redirect,'error');
});
for(const [label,rows] of [['foreign owner',[row('g1','98765432-1234-4234-8234-123456789abc')]],['unknown ID',[row('foreign')]],['duplicate rows',[row(),row()]],['missing row',[]]])test(label+' fails closed',async()=>{
 const {repo}=repository(()=>rows);await assert.rejects(repo.resolveGarments({accessToken:'test-token',garmentIds:['g1']}),error=>error.status===403);
});
test('IDs cannot inject filters or bypass duplicate and count bounds',async()=>{
 const {repo,calls}=repository(()=>[]);for(const ids of [['g1', 'g1'],['g1),user_id.neq.abc'],Array(501).fill('x')])await assert.rejects(repo.resolveGarments({accessToken:'token',garmentIds:ids}),{code:'INVALID_GARMENT_IDS'});assert.equal(calls.length,0);
});
test('upsert assigns verified ownership and removes photos, roles and client scores',async()=>{
 let posted;const {repo}=repository((url,options)=>{posted=JSON.parse(options.body);return posted;});const result=await repo.upsertGarments({accessToken:'test-token',wardrobe:[{...row().attributes,id:'g1',user_id:'attacker',score:999,role:'admin',photo:'SECRET',cutout:{photo:'SECRET'},url:'https://private'}]});assert.equal(posted[0].user_id,userId);assert.equal(result.wardrobe.length,1);assert.doesNotMatch(JSON.stringify(posted),/SECRET|attacker|score|role|private/);
});
test('anonymous and invalid authentication are rejected before data access',async()=>{
 let calls=0;const repo=createSupabaseWardrobeRepository({enabled:true,url:'https://example.supabase.co',publishableKey:'sb_publishable_test',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({id:userId,is_anonymous:true}));}});await assert.rejects(repo.listGarments({accessToken:'token'}),{code:'AUTH_REQUIRED'});assert.equal(calls,1);await assert.rejects(repo.listGarments({accessToken:''}),{code:'AUTH_REQUIRED'});assert.equal(calls,1);
});
test('repository timeout does not expose provider message or token',async()=>{
 const repo=createSupabaseWardrobeRepository({enabled:true,url:'https://example.supabase.co',publishableKey:'sb_publishable_test',timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});await assert.rejects(repo.authenticate('SECRET_TOKEN'),error=>error.code==='SUPABASE_TIMEOUT'&&!error.message.includes('SECRET'));
});
test('applied schema restricts ownership and anonymous access',async()=>{
 const sql=await readFile(new URL('./database/supabase/migrations/20261007222443_closet_initial_storage.sql',import.meta.url),'utf8');
 assert.match(sql,/enable row level security/i);assert.match(sql,/force row level security/i);assert.match(sql,/primary key\s*\(user_id,\s*id\)/i);
 assert.match(sql,/for all to authenticated using/);assert.match(sql,/with check \(\(select auth.uid\(\)\)=user_id/);
 assert.match(sql,/is_anonymous/);assert.doesNotMatch(sql,/grant[^;]+to anon\b/i);assert.doesNotMatch(sql,/user_metadata/);
});
test('metadata validator preserves unknown physical values without copying nested payload',()=>{const clean=garmentMetadata({...row().attributes,id:'g1',warmth:null,materialConfirmed:false,analysis:{photo:'SECRET'}});assert.equal(clean.warmth,null);assert.equal(clean.materialConfirmed,false);assert.equal(clean.analysis,undefined);});
