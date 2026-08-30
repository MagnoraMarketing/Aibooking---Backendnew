-- ---------------------------------------------------------------------------
-- Manual dialer: lets a customer upload a list of leads and call them
-- one-by-one from the browser, as themselves — no AI agent involved. The
-- human-driven counterpart to outbound_campaigns (0013_phone_calling.sql),
-- which dials via the AI agent instead. See lib/twilio/dialer.ts and
-- components/dashboard/dialer-manager.tsx.
--
-- No widget_id on either table: nothing here is tied to an agent, the
-- customer's own Twilio subaccount places the call and bridges it straight
-- to their browser (Twilio Voice SDK) with the lead's number on the other
-- end.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_lists_customer_id on public.lead_lists (customer_id);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  phone_number text not null,
  contact_name text,
  company text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'calling', 'called')),
  disposition text check (
    disposition in ('booked', 'interested', 'not_interested', 'no_answer', 'voicemail', 'wrong_number', 'call_back')
  ),
  call_sid text,
  duration_seconds integer,
  called_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_list_id on public.leads (list_id);
create index if not exists idx_leads_customer_id on public.leads (customer_id);
create index if not exists idx_leads_call_sid on public.leads (call_sid);

-- Per-customer browser-calling credentials, lazily provisioned on first use
-- of the dialer (lib/twilio/dialer.ts's getOrCreateDialerApp) directly
-- under the customer's own Twilio subaccount — a Signing Key (to mint
-- Voice Access Tokens) plus a TwiML Application (Voice Request URL points
-- at dialer-start). Same "never reach the browser, service-role only"
-- posture as twilio_subaccount_auth_token above — no customer-facing RLS
-- policy for these columns either.
alter table public.twilio_subaccounts
  add column if not exists dialer_api_key_sid text,
  add column if not exists dialer_api_key_secret text,
  add column if not exists dialer_twiml_app_sid text;

alter table public.lead_lists enable row level security;
alter table public.leads enable row level security;

-- Same shape as outbound_campaigns' RLS (0013_phone_calling.sql): master
-- admin full access, customer admin read-only (all writes go through
-- service-role API routes).
create policy "master admin full access on lead_lists"
  on public.lead_lists for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own lead_lists"
  on public.lead_lists for select
  using (customer_id = public.current_customer_id());

create policy "master admin full access on leads"
  on public.leads for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own leads"
  on public.leads for select
  using (customer_id = public.current_customer_id());
