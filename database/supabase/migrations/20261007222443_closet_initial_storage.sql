-- ClosetAgent storage schema. Additive initial migration; no personal data imported.
-- Target: qyeobpskafwqnchtkazo. RLS protects user rows; operational data is private.
create schema closet_private;
revoke all on schema closet_private from public, anon, authenticated;
grant usage on schema closet_private to service_role;

create function closet_private.bump_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.revision := 1; new.created_at := now();
  else
    new.revision := old.revision + 1; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function closet_private.bump_revision() from public;

create table public.wardrobe_garments (
 user_id uuid not null references auth.users(id) on delete cascade,
 id text not null check(id ~ '^[A-Za-z0-9_-]{1,100}$'),
 attributes jsonb not null check(jsonb_typeof(attributes)='object')
  check(octet_length(attributes::text)<=16000)
  check(attributes->>'category' is not null and attributes->>'category' in ('top','bottom','dress','shoe','outer'))
  check(not(attributes ?| array['photo','cutout','image','user_id','score','role','apiKey'])),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision bigint not null default 1 check(revision>0), deleted_at timestamptz,
 primary key(user_id,id)
);
create table public.garment_details (
 user_id uuid not null, garment_id text not null,
 display_metadata jsonb not null default '{}' check(jsonb_typeof(display_metadata)='object' and octet_length(display_metadata::text)<=32000),
 review_state jsonb not null default '{}' check(jsonb_typeof(review_state)='object' and octet_length(review_state::text)<=64000),
 capture_metadata jsonb not null default '{}' check(jsonb_typeof(capture_metadata)='object' and octet_length(capture_metadata::text)<=8000),
 schema_version integer not null default 1 check(schema_version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 primary key(user_id,garment_id), foreign key(user_id,garment_id) references public.wardrobe_garments(user_id,id) on delete cascade
);
create table public.garment_analyses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, garment_id text not null,
 input_hash text check(input_hash is null or input_hash ~ '^[a-f0-9]{64}$'),
 model text, schema_version text, analysis jsonb not null check(jsonb_typeof(analysis)='object' and octet_length(analysis::text)<=262144),
 analyzed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 foreign key(user_id,garment_id) references public.wardrobe_garments(user_id,id) on delete cascade
);
create index garment_analyses_owner_garment_time on public.garment_analyses(user_id,garment_id,analyzed_at desc);
create table public.garment_media (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, garment_id text not null,
 role text not null check(role in ('original','cutout','thumbnail')),
 bucket_id text not null default 'closet-media' check(bucket_id='closet-media'),
 object_path text not null check(length(object_path)<=500 and split_part(object_path,'/',1)=user_id::text and split_part(object_path,'/',2)=garment_id and length(split_part(object_path,'/',3))>0 and position('..' in object_path)=0),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
 bytes bigint check(bytes between 1 and 20971520),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','uploaded','ready','failed','deleted')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 unique(bucket_id,object_path),
 foreign key(user_id,garment_id) references public.wardrobe_garments(user_id,id) on delete cascade,
 check(status<>'ready' or (bytes is not null and sha256 is not null))
);
create index garment_media_owner_garment on public.garment_media(user_id,garment_id);
create table public.user_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 profile jsonb not null default '{}' check(jsonb_typeof(profile)='object' and octet_length(profile::text)<=32000),
 location_ids text[] not null default '{}' check(cardinality(location_ids)<=8),
 onboarding jsonb not null default '{}' check(jsonb_typeof(onboarding)='object' and octet_length(onboarding::text)<=32000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0)
);
create table public.daily_contexts (
 user_id uuid not null references auth.users(id) on delete cascade, local_date date not null,
 text text not null default '' check(length(text)<=4000),
 context jsonb not null default '{}' check(jsonb_typeof(context)='object' and octet_length(context::text)<=32000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 primary key(user_id,local_date)
);
create table public.wear_history (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 local_date date not null, item_ids text[] not null check(cardinality(item_ids) between 1 and 5),
 snapshot jsonb not null default '{}' check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=64000),
 source_record_key text not null check(length(source_record_key) between 1 and 200),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 unique(user_id,id), unique(user_id,source_record_key)
);
create index wear_history_owner_date on public.wear_history(user_id,local_date desc);
create table public.wear_feedback (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 history_id uuid, local_date date not null, item_ids text[] not null check(cardinality(item_ids) between 1 and 5),
 feeling text check(feeling in ('cold','hot','ok')), season text not null check(season in ('warm','cold','mild','unknown')),
 wore boolean not null default true, source_record_key text not null check(length(source_record_key) between 1 and 200),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 unique(user_id,source_record_key),
 foreign key(user_id,history_id) references public.wear_history(user_id,id) on delete set null (history_id)
);
create index wear_feedback_owner_date on public.wear_feedback(user_id,local_date desc);
create index wear_feedback_owner_history on public.wear_feedback(user_id,history_id);
create table public.user_legacy_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 answers jsonb not null default '[]' check(jsonb_typeof(answers)='array' and octet_length(answers::text)<=262144),
 confirmed_groups jsonb not null default '[]' check(jsonb_typeof(confirmed_groups)='array' and octet_length(confirmed_groups::text)<=64000),
 preserved_fields jsonb not null default '{}' check(jsonb_typeof(preserved_fields)='object' and octet_length(preserved_fields::text)<=262144),
 schema_version integer not null default 1 check(schema_version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0)
);
create table public.import_batches (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_fingerprint text not null check(length(source_fingerprint) between 1 and 200),
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','running','partial','complete','failed','rolled_back')),
 counts jsonb not null default '{}' check(jsonb_typeof(counts)='object' and octet_length(counts::text)<=8000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 unique(user_id,id), unique(user_id,source_fingerprint,manifest_hash)
);
create index import_batches_owner_status on public.import_batches(user_id,status);
create table public.import_items (
 batch_id uuid not null, user_id uuid not null,
 entity_type text not null check(entity_type in ('garment','detail','analysis','media','preferences','context','history','feedback','legacy')),
 source_key text not null check(length(source_key) between 1 and 200),
 destination_key text, source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 applied_revision bigint check(applied_revision>0),
 status text not null default 'pending' check(status in ('pending','applied','unchanged','conflict','failed','rolled_back')),
 previous_value jsonb check(previous_value is null or octet_length(previous_value::text)<=262144),
 error_code text check(length(error_code)<=100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 primary key(batch_id,entity_type,source_key),
 foreign key(user_id,batch_id) references public.import_batches(user_id,id) on delete cascade
);
create index import_items_owner_batch on public.import_items(user_id,batch_id);
create table public.weather_subscriptions (
 user_id uuid not null references auth.users(id) on delete cascade, location_id text not null check(length(location_id) between 1 and 100),
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision bigint not null default 1 check(revision>0),
 primary key(user_id,location_id)
);
create index weather_subscriptions_active_location on public.weather_subscriptions(location_id) where active;

-- Users cannot access another account, even when garment IDs happen to match.
do $$
declare t text;
begin
 foreach t in array array['wardrobe_garments','garment_details','garment_analyses','garment_media','user_preferences','daily_contexts','wear_history','wear_feedback','user_legacy_state','import_batches','import_items','weather_subscriptions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public, anon, authenticated',t);
  execute format('grant select,insert,update,delete on table public.%I to authenticated,service_role',t);
  execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid())=user_id and not coalesce((select auth.jwt()->>''is_anonymous'')::boolean,false)) with check ((select auth.uid())=user_id and not coalesce((select auth.jwt()->>''is_anonymous'')::boolean,false))',t||'_owner',t);
  execute format('create trigger %I before insert or update on public.%I for each row execute function closet_private.bump_revision()',t||'_revision',t);
 end loop;
end $$;

-- item_ids are checked while the referenced clothes still exist; old records survive garment deletion.
create function closet_private.check_wear_items() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP='UPDATE' and new.item_ids is not distinct from old.item_ids and new.user_id=old.user_id then return new; end if;
 if cardinality(new.item_ids)<>(select count(distinct x) from unnest(new.item_ids) x)
   or exists(select 1 from unnest(new.item_ids) x where not exists(select 1 from public.wardrobe_garments g where g.user_id=new.user_id and g.id=x and g.deleted_at is null))
 then raise exception 'GARMENT_NOT_OWNED_OR_MISSING' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function closet_private.check_wear_items() from public;
create trigger wear_history_items before insert or update on public.wear_history for each row execute function closet_private.check_wear_items();
create trigger wear_feedback_items before insert or update on public.wear_feedback for each row execute function closet_private.check_wear_items();

create table closet_private.weather_cache (
 provider text not null, grid_x integer not null check(grid_x>0), grid_y integer not null check(grid_y>0),
 base_at timestamptz not null, forecast_at timestamptz not null, category text not null,
 value jsonb not null, fetched_at timestamptz not null default now(),
 primary key(provider,grid_x,grid_y,base_at,forecast_at,category)
);
create table closet_private.holiday_cache (
 year integer not null check(year between 2000 and 2200), date date not null, name text not null,
 source text not null, completeness boolean not null default false, fetched_at timestamptz not null default now(),
 primary key(year,date,name), check(extract(year from date)::integer=year)
);
create table closet_private.job_runs (
 job_type text not null, scheduled_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','running','complete','failed')),
 lease_until timestamptz, attempts integer not null default 0 check(attempts>=0),
 result jsonb, updated_at timestamptz not null default now(),
 primary key(job_type,scheduled_at)
);
create table closet_private.recommendation_cache (
 user_id uuid not null references auth.users(id) on delete cascade, cache_key text not null,
 rule_version text not null, expires_at timestamptz not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,cache_key)
);
create index recommendation_cache_expiry on closet_private.recommendation_cache(expires_at);
create table closet_private.ai_budget_accounts (
 budget_key text primary key, cap_won numeric(18,6) not null check(cap_won>=0),
 used_won numeric(18,6) not null default 0 check(used_won>=0),
 reserved_won numeric(18,6) not null default 0 check(reserved_won>=0),
 price_version text not null, updated_at timestamptz not null default now()
);
create table closet_private.ai_calls (
 request_key text primary key, budget_key text not null references closet_private.ai_budget_accounts(budget_key),
 user_id uuid references auth.users(id) on delete set null,
 purpose text not null check(purpose in ('photo-analysis','text-recommendation')),
 state text not null default 'reserved' check(state in ('reserved','settled','uncertain')),
 reserved_won numeric(18,6) not null check(reserved_won>=0),
 charged_won numeric(18,6) check(charged_won>=0), usage jsonb,
 created_at timestamptz not null default now(), settled_at timestamptz
);
create index ai_calls_budget_state on closet_private.ai_calls(budget_key,state);
create index ai_calls_user on closet_private.ai_calls(user_id);
do $$
declare t text;
begin
 foreach t in array array['weather_cache','holiday_cache','job_runs','recommendation_cache','ai_budget_accounts','ai_calls'] loop
  execute format('alter table closet_private.%I enable row level security',t);
  execute format('alter table closet_private.%I force row level security',t);
  execute format('revoke all on table closet_private.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on table closet_private.%I to service_role',t);
 end loop;
end $$;

-- DB-side optimistic concurrency endpoint. Existing bulk upsert remains a legacy API.
create function public.closet_update_garment(p_id text,p_expected_revision bigint,p_attributes jsonb)
returns public.wardrobe_garments language plpgsql security invoker set search_path='' as $$
declare r public.wardrobe_garments;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 update public.wardrobe_garments set attributes=p_attributes
 where user_id=auth.uid() and id=p_id and revision=p_expected_revision and deleted_at is null returning * into r;
 if not found then raise exception 'REVISION_CONFLICT_OR_NOT_FOUND' using errcode='P0001'; end if;
 return r;
end $$;
revoke all on function public.closet_update_garment(text,bigint,jsonb) from public,anon;
grant execute on function public.closet_update_garment(text,bigint,jsonb) to authenticated;

-- Service-only atomic reservation and settlement. Empty accounts: no fresh zero-cost reset.
create function public.closet_reserve_ai(p_request_key text,p_budget_key text,p_user_id uuid,p_purpose text,p_reserved_won numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b closet_private.ai_budget_accounts; c closet_private.ai_calls;
begin
 if p_reserved_won is null or p_reserved_won<=0 or p_reserved_won::text in ('NaN','Infinity','-Infinity') or p_request_key is null or length(p_request_key) not between 1 and 200 then raise exception 'INVALID_RESERVATION'; end if;
 select * into b from closet_private.ai_budget_accounts where budget_key=p_budget_key for update;
 if not found then raise exception 'BUDGET_NOT_INITIALIZED'; end if;
 select * into c from closet_private.ai_calls where request_key=p_request_key;
 if found then
  if c.budget_key<>p_budget_key or c.user_id is distinct from p_user_id or c.purpose<>p_purpose or c.reserved_won<>p_reserved_won then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('state',c.state,'reused',true,'reservedWon',c.reserved_won);
 end if;
 if b.used_won+b.reserved_won+p_reserved_won>b.cap_won then raise exception 'BUDGET_EXCEEDED'; end if;
 insert into closet_private.ai_calls(request_key,budget_key,user_id,purpose,reserved_won) values(p_request_key,p_budget_key,p_user_id,p_purpose,p_reserved_won);
 update closet_private.ai_budget_accounts set reserved_won=reserved_won+p_reserved_won,updated_at=now() where budget_key=p_budget_key;
 return jsonb_build_object('state','reserved','reused',false,'reservedWon',p_reserved_won);
end $$;
create function public.closet_settle_ai(p_request_key text,p_charged_won numeric,p_usage jsonb,p_uncertain boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c closet_private.ai_calls; key text; charge numeric;
begin
 select budget_key into key from closet_private.ai_calls where request_key=p_request_key;
 if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
 perform 1 from closet_private.ai_budget_accounts where budget_key=key for update;
 select * into c from closet_private.ai_calls where request_key=p_request_key for update;
 if c.state<>'reserved' then return jsonb_build_object('state',c.state,'reused',true,'chargedWon',c.charged_won); end if;
 if p_uncertain is null then raise exception 'INVALID_SETTLEMENT'; end if;
 charge := case when p_uncertain then c.reserved_won else p_charged_won end;
 if charge is null or charge<0 or charge::text in ('NaN','Infinity','-Infinity') or (p_usage is not null and jsonb_typeof(p_usage)<>'object') then raise exception 'INVALID_SETTLEMENT'; end if;
 update closet_private.ai_budget_accounts set reserved_won=reserved_won-c.reserved_won,used_won=used_won+charge,updated_at=now() where budget_key=key;
 update closet_private.ai_calls set state=case when p_uncertain then 'uncertain' else 'settled' end,charged_won=charge,usage=p_usage,settled_at=now() where request_key=p_request_key;
 return jsonb_build_object('state',case when p_uncertain then 'uncertain' else 'settled' end,'reused',false,'chargedWon',charge);
end $$;
revoke all on function public.closet_reserve_ai(text,text,uuid,text,numeric) from public,anon,authenticated;
revoke all on function public.closet_settle_ai(text,numeric,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.closet_reserve_ai(text,text,uuid,text,numeric) to service_role;
grant execute on function public.closet_settle_ai(text,numeric,jsonb,boolean) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('closet-media','closet-media',false,20971520,array['image/jpeg','image/png','image/webp','image/heic','image/heif']);
create policy closet_media_select on storage.objects for select to authenticated
using(bucket_id='closet-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy closet_media_insert on storage.objects for insert to authenticated
with check(bucket_id='closet-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)
 and exists(select 1 from public.wardrobe_garments g where g.user_id=(select auth.uid()) and g.id=(storage.foldername(name))[2] and g.deleted_at is null));
create policy closet_media_update on storage.objects for update to authenticated
using(bucket_id='closet-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false))
with check(bucket_id='closet-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false)
 and exists(select 1 from public.wardrobe_garments g where g.user_id=(select auth.uid()) and g.id=(storage.foldername(name))[2] and g.deleted_at is null));
create policy closet_media_delete on storage.objects for delete to authenticated
using(bucket_id='closet-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
