-- Server-only aggregate. Browser identities cannot read or change global budgets.
create function public.closet_ai_budget_snapshot(p_budget_key text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'capWon',a.cap_won,'estimatedUsedWon',a.used_won,'reservedWon',a.reserved_won,
  'generationAttempts',coalesce((select sum(coalesce((usage->>'legacyAttempts')::bigint,1)) from closet_private.ai_calls where budget_key=a.budget_key),0),
  'knownUsageUsd',coalesce((select sum(coalesce((usage->>'usd')::numeric,0)) from closet_private.ai_calls where budget_key=a.budget_key),0),
  'uncertainAttempts',coalesce((select sum(coalesce((usage->>'legacyUncertain')::bigint,case when state in ('reserved','uncertain') then 1 else 0 end)) from closet_private.ai_calls where budget_key=a.budget_key),0)
 ) from closet_private.ai_budget_accounts a where a.budget_key=p_budget_key;
$$;
revoke all on function public.closet_ai_budget_snapshot(text) from public,anon,authenticated;
grant execute on function public.closet_ai_budget_snapshot(text) to service_role;
