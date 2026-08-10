-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies and application code.
-- security definer + fixed search_path so they bypass RLS internally
-- (avoids recursive-RLS on profiles) without being exploitable.
-- ---------------------------------------------------------------------------

create or replace function public.is_master_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'MASTER_ADMIN'
  );
$$;

create or replace function public.current_customer_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select customer_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.is_master_admin() from public;
revoke all on function public.current_customer_id() from public;
grant execute on function public.is_master_admin() to authenticated, service_role;
grant execute on function public.current_customer_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_credit_transaction: the ONLY sanctioned way to mutate credit
-- balances. Inserts an immutable ledger row and atomically updates the
-- cached balance on credit_accounts. Restricted to service_role so credits
-- can never be manipulated directly by a customer or via RLS-permitted
-- writes from the browser.
-- ---------------------------------------------------------------------------
create or replace function public.record_credit_transaction(
  p_customer_id uuid,
  p_amount_seconds bigint,
  p_type text,
  p_description text default null,
  p_usage_session_id uuid default null,
  p_stripe_event_id text default null,
  p_created_by uuid default null
)
returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.credit_accounts;
  v_txn public.credit_transactions;
begin
  select * into v_account from public.credit_accounts
    where customer_id = p_customer_id
    for update;

  if not found then
    insert into public.credit_accounts (customer_id, balance_seconds)
    values (p_customer_id, 0)
    returning * into v_account;
  end if;

  insert into public.credit_transactions (
    customer_id, credit_account_id, amount_seconds, type,
    description, usage_session_id, stripe_event_id, created_by
  ) values (
    p_customer_id, v_account.id, p_amount_seconds, p_type,
    p_description, p_usage_session_id, p_stripe_event_id, p_created_by
  )
  returning * into v_txn;

  update public.credit_accounts
    set balance_seconds = balance_seconds + p_amount_seconds
    where id = v_account.id;

  return v_txn;
end;
$$;

revoke all on function public.record_credit_transaction(uuid, bigint, text, text, uuid, text, uuid) from public;
grant execute on function public.record_credit_transaction(uuid, bigint, text, text, uuid, text, uuid) to service_role;

-- Belt-and-suspenders idempotency: a given Stripe event can only ever
-- produce one ledger entry (in addition to the stripe_events dedup table).
create unique index if not exists uniq_credit_transactions_stripe_event_id
  on public.credit_transactions (stripe_event_id)
  where stripe_event_id is not null;
