begin;
create temporary table cloud_checks(name text primary key,passed boolean default true) on commit drop;
grant all on cloud_checks to authenticated,anon;
select set_config('closet.cloud_a',gen_random_uuid()::text,true),set_config('closet.cloud_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('closet.cloud_a')::uuid),(current_setting('closet.cloud_b')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('closet.cloud_a'),'role','authenticated','is_anonymous',false)::text,true);
do $$
declare s jsonb; saved jsonb; expected bigint; media_path text;
begin
 if public.closet_load_state()->>'revision'<>'0' then raise exception 'NOT_EMPTY'; end if;
 insert into cloud_checks(name) values('new account snapshot empty');
 media_path:=auth.uid()::text||'/cloud-fixture/'||repeat('a',64)||'/original';
 s:=jsonb_build_object('closet',jsonb_build_array(jsonb_build_object('id','cloud-fixture','attributes','{"name":"가상 셔츠","category":"top","warmth":null,"comfort":false,"material":""}'::jsonb,
  'display','{"colorDescription":"회색","hasVision":true}'::jsonb,'capture','{"hasZone":false}'::jsonb,'review','{"intentionalEmpty":["material"]}'::jsonb,'vision','{"model":"fixture","analysis":{"attributes":{}}}'::jsonb,
  'media',jsonb_build_array(jsonb_build_object('role','original','object_path',media_path,'sha256',repeat('a',64),'bytes',3,'mime_type','image/png')))),
  'profile','{"walking":0,"cooling":false}'::jsonb,'locationIds','[]'::jsonb,'onboarding','{"completedAt":null}'::jsonb,'schedule','{"date":"2026-10-08","text":"가상 일정"}'::jsonb,
  'history','[{"date":"2026-10-08","ids":["cloud-fixture"],"names":["가상 셔츠"]}]'::jsonb,'feedback','[{"date":"2026-10-08","ids":["cloud-fixture"],"feeling":"ok","season":"mild","wore":true}]'::jsonb,
  'answers','[]'::jsonb,'confirmedGroups','[]'::jsonb,'preserved','{}'::jsonb);
 saved:=public.closet_save_state(s,0);expected:=(saved->>'revision')::bigint;
 if expected<>1 or jsonb_array_length(saved->'garments')<>1 then raise exception 'SAVE_FAILED'; end if;
 insert into cloud_checks(name) values('atomic initial state save');
 if saved->'preferences'->'profile'->>'walking'<>'0' or saved->'preferences'->'profile'->>'cooling'<>'false' or saved->'garments'->0->'attributes'->'warmth'<>'null'::jsonb then raise exception 'VALUE_LOSS'; end if;
 insert into cloud_checks(name) values('zero false null and empty values preserved');
 if jsonb_array_length(saved->'history')<>1 or jsonb_array_length(saved->'feedback')<>1 or jsonb_array_length(saved->'analyses')<>1 or jsonb_array_length(saved->'contexts')<>1 then raise exception 'RELATED_DATA_LOST'; end if;
 insert into cloud_checks(name) values('history feedback analysis and schedule roundtrip');
 if saved->'media'->0->>'status'<>'pending' then raise exception 'PHOTO_PREMATURE'; end if;
 insert into cloud_checks(name) values('photos pending until verified storage object');
 begin perform public.closet_finish_media(media_path,expected);raise exception 'ACCEPTED_MISSING_PHOTO';exception when sqlstate 'P0001' then if SQLERRM<>'MEDIA_NOT_UPLOADED' then raise;end if;end;
 insert into cloud_checks(name) values('missing storage object cannot finish');
 begin perform public.closet_save_state(s,0);raise exception 'ACCEPTED_STALE';exception when sqlstate 'PT409' then null;end;
 insert into cloud_checks(name) values('stale whole state rejected');
 begin perform public.closet_save_state(jsonb_set(s,'{closet,0,attributes,category}','"bad"'),expected);raise exception 'ACCEPTED_INVALID';exception when check_violation then null;end;
 if public.closet_load_state()->>'revision'<>expected::text then raise exception 'PARTIAL_WRITE';end if;
 insert into cloud_checks(name) values('invalid child rolls back entire save');
 begin perform public.closet_save_state(jsonb_set(s,'{closet,0,media,0,object_path}','"another-user/x/y/original"'),expected);raise exception 'ACCEPTED_FOREIGN_PATH';exception when sqlstate 'P0001' then if SQLERRM<>'INVALID_MEDIA' then raise;end if;end;
 insert into cloud_checks(name) values('foreign storage path rejected');
 saved:=public.closet_save_state(s,expected);expected:=(saved->>'revision')::bigint;
 if expected<>2 or jsonb_array_length(saved->'history')<>1 or jsonb_array_length(saved->'media')<>1 then raise exception 'RETRY_DUPLICATED';end if;
 insert into cloud_checks(name) values('retry does not duplicate media or history');
 perform set_config('closet.cloud_path',media_path,true);perform set_config('closet.cloud_revision',expected::text,true);
end $$;
reset role;
-- Metadata fixtures only; no file is sent to Storage, and the transaction rolls back.
insert into storage.objects(bucket_id,name,metadata) values('closet-media',current_setting('closet.cloud_path'),'{"size":3,"mimetype":"image/png"}');
set local role authenticated;
select public.closet_finish_media(current_setting('closet.cloud_path'),current_setting('closet.cloud_revision')::bigint);
do $$begin
 if public.closet_load_state()->'media'->0->>'status'<>'ready' then raise exception 'NOT_READY';end if;
 insert into cloud_checks(name) values('matching uploaded object can finish');
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('closet.cloud_b'),'role','authenticated','is_anonymous',false)::text,true);
do $$begin
 if jsonb_array_length(public.closet_load_state()->'garments')<>0 then raise exception 'FOREIGN_READ';end if;
 insert into cloud_checks(name) values('other account snapshot is isolated');
 begin perform public.closet_finish_media(current_setting('closet.cloud_path'),0);raise exception 'FOREIGN_FINISH';exception when sqlstate 'PT409' then null;end;
 insert into cloud_checks(name) values('other account cannot finish photo');
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('closet.cloud_a'),'role','authenticated','is_anonymous',true)::text,true);
do $$begin
 if jsonb_array_length(public.closet_load_state()->'garments')<>1 then raise exception 'DEMO_READ_FAILED';end if;
 insert into cloud_checks(name) values('authenticated demo identity can load own snapshot');
end $$;
reset role;
select jsonb_build_object('passed',count(*),'checks',jsonb_agg(name order by name),'rolledBack',true) as verification from cloud_checks;
rollback;
