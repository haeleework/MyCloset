import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
const db=new PGlite();
try{
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
grant usage on schema public,auth,storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated,service_role;
create function storage.foldername(text) returns text[] language sql immutable as 'select (string_to_array($1,''/''))[1:array_length(string_to_array($1,''/''),1)-1]';
`);
const migrations=(await fs.readdir(new URL('./supabase/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort();
for(const migration of migrations)await db.exec(await fs.readFile(new URL('./supabase/migrations/'+migration,import.meta.url),'utf8'));
const reports=[];
for(const file of ['verification.sql','cloud-verification.sql']){
 const results=await db.exec(await fs.readFile(new URL('./'+file,import.meta.url),'utf8'));
 const report=results.flatMap(r=>r.rows).find(r=>r.verification)?.verification;
 if(!report)throw new Error('Missing verification results');reports.push(report);
}
const report={passed:reports.reduce((n,r)=>n+r.passed,0),checks:reports.flatMap(r=>r.checks),rolledBack:reports.every(r=>r.rolledBack)};
const remaining=await db.query('select (select count(*) from auth.users) as users,(select count(*) from public.wardrobe_garments) as garments,(select count(*) from closet_private.ai_budget_accounts) as budgets');
const output={engine:'PGlite local PostgreSQL',...report,afterRollback:remaining.rows[0]};
await fs.writeFile(new URL('./local-verification.json',import.meta.url),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
} finally {await db.close();}
