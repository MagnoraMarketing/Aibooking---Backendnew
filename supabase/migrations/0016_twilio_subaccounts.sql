-- ---------------------------------------------------------------------------
-- twilio_subaccounts: one Twilio subaccount per AIbooking customer, created
-- lazily under the platform's master Twilio account the first time a
-- customer buys a number through us (see lib/twilio/subaccounts.ts). Buying
-- and releasing numbers then happens inside the customer's own subaccount
-- rather than directly on the master account — cleaner billing/usage
-- isolation per tenant, and a natural blast-radius boundary (releasing or
-- suspending one customer's subaccount can never touch another's numbers).
--
-- auth_token is a live Twilio credential (used server-side to act on the
-- subaccount and handed to Vapi's phone-number import) and must never reach
-- the browser — unlike phone_numbers, there is deliberately no "customer can
-- view own" RLS policy here at all, only master admin / service role.
-- ---------------------------------------------------------------------------
create table if not exists public.twilio_subaccounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers (id) on delete cascade,
  twilio_subaccount_sid text not null unique,
  twilio_subaccount_auth_token text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.twilio_subaccounts;
create trigger set_updated_at before update on public.twilio_subaccounts
  for each row execute function public.set_updated_at();

alter table public.twilio_subaccounts enable row level security;

create policy "master admin full access on twilio_subaccounts"
  on public.twilio_subaccounts for all
  using (public.is_master_admin())
  with check (public.is_master_admin());
