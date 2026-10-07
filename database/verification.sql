begin;
create temporary table closet_verification_results(name text primary key,passed boolean not null) on commit drop;
grant select,insert on closet_verification_results to authenticated,anon,service_role;
select set_config('closet.test_a',gen_random_uuid()::text,true),set_config('closet.test_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('closet.test_a')::uuid),(current_setting('closet.test_b')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('closet.test_a'),'role','authenticated','is_anonymous',false)::text,true);
insert into public.wardrobe_garments(user_id,id,attributes) values
(current_setting('closet.test_a')::uuid,'fixture', '{"name":"schema fixture","category":"bottom","warmth":null,"comfort":false,"thickness":"medium","thicknessSource":"ai_estimate","thicknessEvidence":"fixture"}');
insert into public.garment_details(user_id,garment_id,review_state) values(current_setting('closet.test_a')::uuid,'fixture','{"intentionalEmpty":["material"]}');
insert into public.garment_analyses(user_id,garment_id,analysis) values(current_setting('closet.test_a')::uuid,'fixture','{"attributes":{}}');
insert into public.garment_media(user_id,garment_id,role,object_path,mime_type) values(current_setting('closet.test_a')::uuid,'fixture','original',current_setting('closet.test_a')||'/fixture/test/original.jpg','image/jpeg');
insert into public.user_preferences(user_id,profile,location_ids) values(current_setting('closet.test_a')::uuid,'{"moodPreferences":[]}','{}');
insert into public.daily_contexts(user_id,local_date,text) values(current_setting('closet.test_a')::uuid,'2026-10-08','fixture');
insert into public.wear_history(user_id,local_date,item_ids,source_record_key) values(current_setting('closet.test_a')::uuid,'2026-10-08',array['fixture'],'test-history');
insert into public.wear_feedback(user_id,local_date,item_ids,history_id,feeling,season,source_record_key)
 select user_id,local_date,item_ids,id,'ok','mild','test-feedback' from public.wear_history;
insert into public.user_legacy_state(user_id) values(current_setting('closet.test_a')::uuid);
insert into public.import_batches(user_id,source_fingerprint,manifest_hash) values(current_setting('closet.test_a')::uuid,'fixture',repeat('a',64));
insert into public.import_items(user_id,batch_id,entity_type,source_key,source_hash)
 select user_id,id,'garment','fixture',repeat('a',64) from public.import_batches;
insert into public.weather_subscriptions(user_id,location_id) values(current_setting('closet.test_a')::uuid,'seoul');
insert into closet_verification_results values('owner CRUD all 12 user tables',true);
do $$
declare r public.wardrobe_garments;
begin
 select * into r from public.closet_update_garment('fixture',1,'{"category":"bottom","warmth":null,"comfort":false,"material":""}');
 if r.revision<>2 or r.attributes->'warmth'<>'null'::jsonb or r.attributes->'comfort'<>'false'::jsonb or r.attributes->>'material'<>'' then raise exception 'REVISION_OR_UNKNOWN_LOSS'; end if;
 insert into closet_verification_results values('revision increments and null false empty preserved',true);
 begin
  perform public.closet_update_garment('fixture',1,'{"category":"top"}');
  raise exception 'STALE_REVISION_ACCEPTED';
 exception when sqlstate 'P0001' then if SQLERRM<>'REVISION_CONFLICT_OR_NOT_FOUND' then raise; end if; end;
 insert into closet_verification_results values('stale revision rejected',true);
 begin
  insert into public.wardrobe_garments(user_id,id,attributes) values(current_setting('closet.test_a')::uuid,'bad','{"category":"top","photo":"data:fake"}');
  raise exception 'PHOTO_ACCEPTED';
 exception when check_violation then null; end;
 insert into closet_verification_results values('photo excluded from attributes',true);
 begin
  update public.wardrobe_garments set user_id=current_setting('closet.test_b')::uuid where id='fixture';
  raise exception 'OWNER_TRANSFER_ACCEPTED';
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('ownership reassignment rejected',true);
 begin
  perform public.closet_reserve_ai('x','x',null,'photo-analysis',1);
  raise exception 'USER_BUDGET_ACCESS_ACCEPTED';
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('user cannot reserve operational budget',true);
end $$;

-- Storage policy rows are temporary test metadata; no actual photo file is uploaded.
insert into storage.objects(bucket_id,name) values('closet-media',current_setting('closet.test_a')||'/fixture/test/original.jpg');
insert into closet_verification_results values('owner storage insert allowed',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('closet.test_b'),'role','authenticated','is_anonymous',false)::text,true);
insert into public.wardrobe_garments(user_id,id,attributes) values(current_setting('closet.test_b')::uuid,'fixture','{"category":"top"}');
do $$
declare t text; n integer;
begin
 foreach t in array array['wardrobe_garments','garment_details','garment_analyses','garment_media','user_preferences','daily_contexts','wear_history','wear_feedback','user_legacy_state','import_batches','import_items','weather_subscriptions'] loop
  execute format('select count(*) from public.%I where user_id=$1',t) into n using current_setting('closet.test_a')::uuid;
  if n<>0 then raise exception 'FOREIGN_ROWS_VISIBLE %',t; end if;
  insert into closet_verification_results values('cross-account read denied: '||t,true);
 end loop;
 update public.wardrobe_garments set attributes='{"category":"outer"}' where user_id=current_setting('closet.test_a')::uuid;
 get diagnostics n = row_count;
 if n<>0 then raise exception 'FOREIGN_UPDATE_ACCEPTED'; end if;
 delete from public.wardrobe_garments where user_id=current_setting('closet.test_a')::uuid;
 get diagnostics n = row_count;
 if n<>0 then raise exception 'FOREIGN_DELETE_ACCEPTED'; end if;
 insert into closet_verification_results values('cross-account update delete denied',true);
 begin
  insert into public.garment_details(user_id,garment_id) values(current_setting('closet.test_a')::uuid,'fixture');
  raise exception 'FOREIGN_INSERT_ACCEPTED';
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('cross-account insert denied',true);
 begin
  insert into public.wear_feedback(user_id,history_id,local_date,item_ids,feeling,season,source_record_key)
  values(current_setting('closet.test_b')::uuid,(select id from public.wear_history where user_id=current_setting('closet.test_a')::uuid),'2026-10-08',array['missing'],'ok','mild','invalid');
  raise exception 'FOREIGN_WEAR_ACCEPTED';
 exception when check_violation then null; end;
 insert into closet_verification_results values('missing wear garment rejected',true);
 if exists(select 1 from storage.objects where name like current_setting('closet.test_a')||'/%') then raise exception 'FOREIGN_STORAGE_VISIBLE'; end if;
 begin
  insert into storage.objects(bucket_id,name) values('closet-media',current_setting('closet.test_a')||'/fixture/test/stolen.jpg');
  raise exception 'FOREIGN_STORAGE_INSERT_ACCEPTED';
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('cross-account storage read insert denied',true);
 update storage.objects set name=current_setting('closet.test_b')||'/fixture/test/moved.jpg' where name like current_setting('closet.test_a')||'/%';
 get diagnostics n = row_count;
 if n<>0 then raise exception 'FOREIGN_STORAGE_UPDATE_ACCEPTED'; end if;
 insert into closet_verification_results values('cross-account storage update denied',true);
 -- Hosted Storage blocks SQL DELETE even for zero rows. Do not bypass its guard.
 begin
  delete from storage.objects where name like current_setting('closet.test_a')||'/%';
  get diagnostics n = row_count;
  if n<>0 then raise exception 'FOREIGN_STORAGE_DELETE_ACCEPTED'; end if;
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('storage SQL deletion denied or zero foreign rows',true);
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('closet.test_a'),'role','authenticated','is_anonymous',true)::text,true);
do $$ begin
 if exists(select 1 from public.wardrobe_garments) then raise exception 'ANONYMOUS_SIGNIN_READ_ACCEPTED'; end if;
 begin
  insert into public.user_preferences(user_id) values(current_setting('closet.test_a')::uuid);
  raise exception 'ANONYMOUS_SIGNIN_WRITE_ACCEPTED';
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('anonymous sign-in denied',true);
end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.wardrobe_garments; raise exception 'ANON_TABLE_ACCESS_ACCEPTED';
 exception when insufficient_privilege then null; end;
 begin perform public.closet_update_garment('fixture',2,'{"category":"top"}'); raise exception 'ANON_RPC_ACCEPTED';
 exception when insufficient_privilege then null; end;
 insert into closet_verification_results values('unauthenticated table and RPC denied',true);
end $$;
reset role;
insert into closet_private.ai_budget_accounts(budget_key,cap_won,price_version) values('schema-test',100,'fixture');
set local role service_role;
do $$
declare r jsonb; n numeric;
begin
 perform public.closet_reserve_ai('schema-r1','schema-test',null,'text-recommendation',70);
 r:=public.closet_reserve_ai('schema-r1','schema-test',null,'text-recommendation',70);
 if r->>'reused'<>'true' then raise exception 'IDEMPOTENCY_FAILED'; end if;
 select reserved_won into n from closet_private.ai_budget_accounts where budget_key='schema-test';
 if n<>70 then raise exception 'DUPLICATE_RESERVATION'; end if;
 insert into closet_verification_results values('reservation idempotent',true);
 begin
  perform public.closet_reserve_ai('schema-r2','schema-test',null,'photo-analysis',40);
  raise exception 'OVER_BUDGET_ACCEPTED';
 exception when sqlstate 'P0001' then if SQLERRM<>'BUDGET_EXCEEDED' then raise; end if; end;
 insert into closet_verification_results values('shared budget overspend rejected',true);
 perform public.closet_settle_ai('schema-r1',20,'{"totalTokens":null}',false);
 perform public.closet_settle_ai('schema-r1',20,'{}',false);
 select used_won into n from closet_private.ai_budget_accounts where budget_key='schema-test';
 if n<>20 then raise exception 'DUPLICATE_CHARGE'; end if;
 insert into closet_verification_results values('settlement exactly once',true);
 perform public.closet_reserve_ai('schema-r3','schema-test',null,'photo-analysis',50);
 perform public.closet_settle_ai('schema-r3',null,null,true);
 select used_won into n from closet_private.ai_budget_accounts where budget_key='schema-test';
 if n<>70 then raise exception 'UNCERTAIN_RESERVATION_RELEASED'; end if;
 insert into closet_verification_results values('uncertain call conservatively charged',true);
 begin
  perform public.closet_reserve_ai('schema-r4','not-initialized',null,'photo-analysis',1);
  raise exception 'UNINITIALIZED_BUDGET_ACCEPTED';
 exception when sqlstate 'P0001' then if SQLERRM<>'BUDGET_NOT_INITIALIZED' then raise; end if; end;
 insert into closet_verification_results values('empty budget does not reset costs',true);
end $$;
reset role;
select jsonb_build_object('passed',count(*),'checks',jsonb_agg(name order by name),'rolledBack',true) as verification from closet_verification_results;
rollback;
