-- Clarify server-only policies and normalize auth initplans for the hosted advisor.
do $$
declare t text;
begin
 foreach t in array array['wardrobe_garments','garment_details','garment_analyses','garment_media','user_preferences','daily_contexts','wear_history','wear_feedback','user_legacy_state','import_batches','import_items','weather_subscriptions'] loop
  execute format('alter policy %I on public.%I using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>''is_anonymous'')::boolean,false)) with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>''is_anonymous'')::boolean,false))',t||'_owner',t);
 end loop;
 foreach t in array array['weather_cache','holiday_cache','job_runs','recommendation_cache','ai_budget_accounts','ai_calls'] loop
  execute format('create policy %I on closet_private.%I for all to service_role using (true) with check (true)',t||'_server_only',t);
 end loop;
 -- Keep the platform's existing event-trigger body and behavior intact.
 if to_regprocedure('public.rls_auto_enable()') is not null then
  execute 'revoke execute on function public.rls_auto_enable() from public,anon,authenticated';
 end if;
end $$;
