-- User-scoped atomic state persistence. Photos travel directly to private Storage.
-- All functions use the caller's privileges and existing RLS, never service_role.
create function public.closet_load_state() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare u uuid := auth.uid(); result jsonb;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('closet-state:'||u::text));
 if (select count(*) from public.wardrobe_garments where user_id=u and deleted_at is null)>500 then raise exception 'WARDROBE_LIMIT'; end if;
 select jsonb_build_object(
  'userId',u,'revision',coalesce((select revision from public.user_preferences where user_id=u),0),
  'garments',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.wardrobe_garments g where user_id=u and deleted_at is null),'[]'::jsonb),
  'details',coalesce((select jsonb_agg(to_jsonb(d) order by garment_id) from public.garment_details d where user_id=u),'[]'::jsonb),
  'analyses',coalesce((select jsonb_agg(to_jsonb(a) order by garment_id) from (select distinct on(garment_id) * from public.garment_analyses where user_id=u order by garment_id,created_at desc,id) a),'[]'::jsonb),
  'media',coalesce((select jsonb_agg(to_jsonb(m) order by object_path) from public.garment_media m where user_id=u and status<>'deleted'),'[]'::jsonb),
  'preferences',(select to_jsonb(p) from public.user_preferences p where user_id=u),
  'contexts',coalesce((select jsonb_agg(to_jsonb(c) order by local_date) from public.daily_contexts c where user_id=u),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by local_date,source_record_key) from public.wear_history h where user_id=u),'[]'::jsonb),
  'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by local_date,source_record_key) from public.wear_feedback f where user_id=u),'[]'::jsonb),
  'legacy',(select to_jsonb(l) from public.user_legacy_state l where user_id=u)
 ) into result;
 return result;
end $$;
revoke all on function public.closet_load_state() from public,anon;
grant execute on function public.closet_load_state() to authenticated;

create function public.closet_save_state(p_state jsonb,p_expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare u uuid := auth.uid(); current_revision bigint; g jsonb; m jsonb; h jsonb; ids text[]; v_ids text[]; pref public.user_preferences; object_name text;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>4000000
   or jsonb_typeof(p_state->'closet') is distinct from 'array' or jsonb_array_length(p_state->'closet')>500
   or jsonb_typeof(p_state->'history') is distinct from 'array' or jsonb_array_length(p_state->'history')>5000
   or jsonb_typeof(p_state->'feedback') is distinct from 'array' or jsonb_array_length(p_state->'feedback')>5000 then raise exception 'INVALID_STATE'; end if;
 perform pg_advisory_xact_lock(hashtext('closet-state:'||u::text));
 select revision into current_revision from public.user_preferences where user_id=u for update;
 if p_expected_revision is null or p_expected_revision<>coalesce(current_revision,0) then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
 select coalesce(array_agg(value->>'id'),'{}') into ids from jsonb_array_elements(p_state->'closet');
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'INVALID_STATE'; end if;
 for g in select value from jsonb_array_elements(p_state->'closet') loop
  insert into public.wardrobe_garments(user_id,id,attributes) values(u,g->>'id',g->'attributes')
  on conflict(user_id,id) do update set attributes=excluded.attributes,deleted_at=null;
  insert into public.garment_details(user_id,garment_id,display_metadata,review_state,capture_metadata)
   values(u,g->>'id',coalesce(g->'display','{}'),jsonb_build_object('userReview',g->'review','media',coalesce(g->'media','[]')),coalesce(g->'capture','{}'))
   on conflict(user_id,garment_id) do update set display_metadata=excluded.display_metadata,review_state=excluded.review_state,capture_metadata=excluded.capture_metadata;
  if g->'vision' is not null and g->'vision'<>'null'::jsonb then
   if not exists(select 1 from public.garment_analyses where user_id=u and garment_id=g->>'id' and analysis=g->'vision') then
    insert into public.garment_analyses(user_id,garment_id,model,analysis) values(u,g->>'id',g->'vision'->>'model',g->'vision');
   end if;
  end if;
  if jsonb_typeof(coalesce(g->'media','[]'))<>'array' or jsonb_array_length(coalesce(g->'media','[]'))>2 then raise exception 'INVALID_MEDIA'; end if;
  for m in select value from jsonb_array_elements(coalesce(g->'media','[]')) loop
   object_name:=u::text||'/'||(g->>'id')||'/'||(m->>'sha256')||'/'||(m->>'role');
   if m->>'object_path' is distinct from object_name or m->>'role' not in ('original','cutout') then raise exception 'INVALID_MEDIA'; end if;
   insert into public.garment_media(user_id,garment_id,role,object_path,mime_type,bytes,sha256,status)
    values(u,g->>'id',m->>'role',object_name,m->>'mime_type',(m->>'bytes')::bigint,m->>'sha256','pending')
    on conflict(bucket_id,object_path) do nothing;
  end loop;
 end loop;
 insert into public.user_preferences(user_id,profile,location_ids,onboarding)
  values(u,p_state->'profile',array(select jsonb_array_elements_text(p_state->'locationIds')),p_state->'onboarding')
  on conflict(user_id) do update set profile=excluded.profile,location_ids=excluded.location_ids,onboarding=excluded.onboarding returning * into pref;
 if p_state->'schedule'->>'date' is not null then
  insert into public.daily_contexts(user_id,local_date,text,context) values(u,(p_state->'schedule'->>'date')::date,coalesce(p_state->'schedule'->>'text',''),p_state->'schedule')
   on conflict(user_id,local_date) do update set text=excluded.text,context=excluded.context;
 end if;
 for h in select value from jsonb_array_elements(p_state->'history') loop
  v_ids:=array(select jsonb_array_elements_text(h->'ids'));
  insert into public.wear_history(user_id,local_date,item_ids,snapshot,source_record_key)
   values(u,(h->>'date')::date,v_ids,h,'app:'||(h->>'date'))
   on conflict(user_id,source_record_key) do update set item_ids=excluded.item_ids,snapshot=excluded.snapshot;
 end loop;
 for h in select value from jsonb_array_elements(p_state->'feedback') loop
  v_ids:=array(select jsonb_array_elements_text(h->'ids'));
  insert into public.wear_feedback(user_id,local_date,item_ids,feeling,season,wore,source_record_key)
   values(u,(h->>'date')::date,v_ids,h->>'feeling',coalesce(h->>'season','unknown'),coalesce((h->>'wore')::boolean,true),'app:'||(h->>'date'))
   on conflict(user_id,source_record_key) do update set item_ids=excluded.item_ids,feeling=excluded.feeling,season=excluded.season,wore=excluded.wore;
 end loop;
 -- Soft deletion preserves historical references and original Storage objects.
 update public.wardrobe_garments set deleted_at=now() where user_id=u and deleted_at is null and not(id=any(ids));
 insert into public.user_legacy_state(user_id,answers,confirmed_groups,preserved_fields)
  values(u,coalesce(p_state->'answers','[]'),coalesce(p_state->'confirmedGroups','[]'),coalesce(p_state->'preserved','{}'))
  on conflict(user_id) do update set answers=excluded.answers,confirmed_groups=excluded.confirmed_groups,preserved_fields=excluded.preserved_fields;
 update public.weather_subscriptions set active=false where user_id=u;
 insert into public.weather_subscriptions(user_id,location_id,active) select u,x,true from unnest(pref.location_ids) x
  on conflict(user_id,location_id) do update set active=true;
 return public.closet_load_state();
end $$;
revoke all on function public.closet_save_state(jsonb,bigint) from public,anon;
grant execute on function public.closet_save_state(jsonb,bigint) to authenticated;

create function public.closet_finish_media(p_path text,p_expected_revision bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare u uuid:=auth.uid(); m public.garment_media; meta jsonb;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('closet-state:'||u::text));
 if p_expected_revision is distinct from (select revision from public.user_preferences where user_id=u) then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
 select * into m from public.garment_media where user_id=u and object_path=p_path;
 if not found then raise exception 'MEDIA_NOT_FOUND'; end if;
 select metadata into meta from storage.objects where bucket_id='closet-media' and name=p_path;
 if meta is null or (meta->>'size')::bigint is distinct from m.bytes or meta->>'mimetype' is distinct from m.mime_type then raise exception 'MEDIA_NOT_UPLOADED'; end if;
 update public.garment_media set status='ready' where id=m.id and user_id=u;
end $$;
revoke all on function public.closet_finish_media(text,bigint) from public,anon;
grant execute on function public.closet_finish_media(text,bigint) to authenticated;
