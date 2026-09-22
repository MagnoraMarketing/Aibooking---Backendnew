-- ---------------------------------------------------------------------------
-- Pricing/billing overhaul:
--
-- 1. Setup fee now scales with the package instead of a flat 999 kr for
--    every tier (0018/0042 set every package to the same 999 kr setup_fee).
--    Matches what checkout actually charges once it becomes optional
--    (see createCheckoutSession's includeSetup param) rather than a fixed
--    amount unrelated to what was bought.
--
-- 2. credit_accounts.recharge_pending_at: an atomic claim so two concurrent
--    calls that both see an exhausted pool can't both charge Stripe for the
--    same recharge (see lib/credits/refill.ts). Set right before the Stripe
--    charge, cleared in a finally — a stale claim (a crashed request) simply
--    blocks the next legitimate recharge attempt rather than double-billing,
--    and is self-healing after RECHARGE_CLAIM_STALE_MINUTES (application-side).
-- ---------------------------------------------------------------------------

update public.packages set setup_fee = monthly_price where package_name = 'Starter';
update public.packages set setup_fee = monthly_price where package_name = 'Professional';
update public.packages set setup_fee = monthly_price where package_name = 'Enterprise';

alter table public.credit_accounts
  add column if not exists recharge_pending_at timestamptz;

-- Atomically claims the right to attempt a pool-exhaustion recharge for a
-- customer: returns true (and stamps recharge_pending_at) only if no claim
-- is already in flight, or the previous one is older than p_stale_minutes
-- (self-healing after a crashed/timed-out request, so a permanent lockout
-- never happens). The insert-or-update-with-a-condition is a single atomic
-- statement — two concurrent callers can't both see "unclaimed" and both
-- proceed, which a separate select-then-update in application code could.
-- Cleared back to null by the caller once the attempt finishes (success or
-- failure) — see lib/credits/refill.ts.
create or replace function public.try_claim_recharge(p_customer_id uuid, p_stale_minutes integer default 5)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into public.credit_accounts (customer_id, balance_seconds, recharge_pending_at)
  values (p_customer_id, 0, now())
  on conflict (customer_id) do update
    set recharge_pending_at = now()
    where public.credit_accounts.recharge_pending_at is null
       or public.credit_accounts.recharge_pending_at < now() - make_interval(mins => p_stale_minutes)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.try_claim_recharge(uuid, integer) from public;
grant execute on function public.try_claim_recharge(uuid, integer) to service_role;
