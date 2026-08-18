-- ---------------------------------------------------------------------------
-- Phone calling (inbound + outbound), grouped together since both are built
-- on the same resource — a Vapi phone number — while the existing widget
-- stays a separate, unrelated channel (web SDK, no phone number involved).
-- All three reuse the same Vapi assistant per agent (widgets.llm_model_id
-- provider='vapi', widget_settings.extra.vapiAssistantId) — a phone number
-- is just another way to reach that same assistant, an outbound call is the
-- assistant placing a call instead of receiving one. See lib/vapi/calls.ts
-- and lib/vapi/phone-numbers.ts.
-- ---------------------------------------------------------------------------

create table if not exists public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  vapi_phone_number_id text not null unique,
  phone_number text not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_phone_numbers_customer_id on public.phone_numbers (customer_id);
create index if not exists idx_phone_numbers_widget_id on public.phone_numbers (widget_id);

-- ---------------------------------------------------------------------------
-- outbound_campaigns / outbound_campaign_contacts — a campaign is a batch of
-- numbers to call from a given phone_number using a given agent. "Launched"
-- fires one Vapi outbound call per contact (lib/vapi/calls.ts) and is a
-- one-way transition — a campaign isn't resumable/editable after launch,
-- matching the agreed "bulk campaign" scope (no scheduling/retry logic yet).
-- ---------------------------------------------------------------------------
create table if not exists public.outbound_campaigns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers (id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'launched')),
  created_at timestamptz not null default now(),
  launched_at timestamptz
);

create index if not exists idx_outbound_campaigns_customer_id on public.outbound_campaigns (customer_id);

create table if not exists public.outbound_campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outbound_campaigns (id) on delete cascade,
  phone_number text not null,
  contact_name text,
  status text not null default 'pending' check (status in ('pending', 'calling', 'completed', 'failed')),
  vapi_call_id text,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_outbound_campaign_contacts_campaign_id on public.outbound_campaign_contacts (campaign_id);
create index if not exists idx_outbound_campaign_contacts_vapi_call_id on public.outbound_campaign_contacts (vapi_call_id);

-- ---------------------------------------------------------------------------
-- phone_calls — billing/audit record for both inbound and outbound calls,
-- the phone equivalent of usage_sessions. Populated from Vapi's
-- "end-of-call-report" webhook event (app/api/webhooks/vapi/route.ts), which
-- is also where the matching credit_transactions deduction happens via
-- lib/credits/ledger.ts's deductPhoneCallCost — same balance_seconds pool
-- as widget usage, per the agreed "one shared balance" scope.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  phone_number_id uuid references public.phone_numbers (id) on delete set null,
  campaign_contact_id uuid references public.outbound_campaign_contacts (id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  vapi_call_id text not null unique,
  duration_seconds integer not null default 0,
  ended_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_phone_calls_customer_id on public.phone_calls (customer_id);

alter table public.phone_numbers enable row level security;
alter table public.outbound_campaigns enable row level security;
alter table public.outbound_campaign_contacts enable row level security;
alter table public.phone_calls enable row level security;

-- Same shape as widgets' RLS (0003_rls.sql): master admin full access,
-- customer admin read-only (all writes go through service-role API routes,
-- same defense-in-depth rationale as the rest of the app).
create policy "master admin full access on phone_numbers"
  on public.phone_numbers for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own phone_numbers"
  on public.phone_numbers for select
  using (customer_id = public.current_customer_id());

create policy "master admin full access on outbound_campaigns"
  on public.outbound_campaigns for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own outbound_campaigns"
  on public.outbound_campaigns for select
  using (customer_id = public.current_customer_id());

create policy "master admin full access on outbound_campaign_contacts"
  on public.outbound_campaign_contacts for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own outbound_campaign_contacts"
  on public.outbound_campaign_contacts for select
  using (
    campaign_id in (
      select id from public.outbound_campaigns where customer_id = public.current_customer_id()
    )
  );

create policy "master admin full access on phone_calls"
  on public.phone_calls for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own phone_calls"
  on public.phone_calls for select
  using (customer_id = public.current_customer_id());
