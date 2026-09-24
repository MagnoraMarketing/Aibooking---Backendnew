-- Safe to run more than once: every object is created "if not exists" or
-- dropped first, so running it again after a partial or complete run is a
-- no-op rather than an "already exists" error.
--
-- Outbound dialer, second pass: what the manual dialer and AI campaigns were
-- still missing to be used for real calling lists.
--
-- Everything telephony still runs through the customer's own Twilio
-- subaccount under the platform's master account (0016, 0029). The customer
-- never sees Twilio: they buy a number here, and every call below goes out
-- through it.
--
--   * leads carry email and arbitrary CSV columns (custom_data), can be put
--     on callback or do-not-call, and count their attempts.
--   * dialer_calls: one row per manual browser call, so a lead has a call
--     history (and recordings) instead of a single overwritten call_sid.
--   * do_not_call_numbers: a per-customer suppression list that neither the
--     manual dialer nor an AI campaign will ever ring.
--   * campaign contacts carry the same lead fields (so an AI agent can say
--     {{name}} and {{company}}), plus the call's outcome and AI summary.

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists email text,
  add column if not exists custom_data jsonb not null default '{}'::jsonb,
  add column if not exists attempt_count integer not null default 0,
  -- When a callback is due. Set with status 'callback'; the dialer queue
  -- puts due callbacks ahead of fresh leads.
  add column if not exists next_call_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check
    check (status in ('pending', 'calling', 'called', 'callback', 'do_not_call'));

alter table public.leads drop constraint if exists leads_disposition_check;
alter table public.leads
  add constraint leads_disposition_check
    check (
      disposition in (
        'booked', 'interested', 'not_interested', 'no_answer', 'busy', 'voicemail',
        'wrong_number', 'call_back', 'do_not_call', 'other'
      )
    );

drop trigger if exists set_updated_at on public.leads;
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create index if not exists idx_leads_list_status on public.leads (list_id, status);
create index if not exists idx_leads_customer_phone on public.leads (customer_id, phone_number);
create index if not exists idx_leads_next_call_at on public.leads (next_call_at) where next_call_at is not null;

-- ---------------------------------------------------------------------------
-- dialer_calls — one manual (human, browser) call.
--
-- twilio_call_sid is the browser leg's CallSid, known the moment Twilio asks
-- dialer-start for TwiML; the dialled <Number> leg reports back with it as
-- ParentCallSid, and the recording callback with it as CallSid. Unique, so a
-- redelivered webhook updates the same row instead of adding one.
--
-- Recordings are stored by sid only. The audio stays in the customer's
-- subaccount and is streamed through an authenticated route — never a raw
-- Twilio URL in the browser.
-- ---------------------------------------------------------------------------
create table if not exists public.dialer_calls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  list_id uuid references public.lead_lists (id) on delete set null,
  user_id uuid,
  twilio_call_sid text not null unique,
  from_number text not null,
  to_number text not null,
  status text not null default 'initiated',
  duration_seconds integer,
  recording_sid text,
  recording_status text,
  recording_duration_seconds integer,
  outcome text,
  notes text,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_dialer_calls_customer_created on public.dialer_calls (customer_id, created_at desc);
create index if not exists idx_dialer_calls_lead on public.dialer_calls (lead_id, created_at desc);

alter table public.dialer_calls enable row level security;

drop policy if exists "master admin full access on dialer_calls" on public.dialer_calls;
create policy "master admin full access on dialer_calls"
  on public.dialer_calls for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "customer admin can view own dialer_calls" on public.dialer_calls;
create policy "customer admin can view own dialer_calls"
  on public.dialer_calls for select
  using (customer_id = public.current_customer_id());

-- ---------------------------------------------------------------------------
-- do_not_call_numbers — per-customer suppression list.
-- ---------------------------------------------------------------------------
create table if not exists public.do_not_call_numbers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  phone_number text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (customer_id, phone_number)
);

alter table public.do_not_call_numbers enable row level security;

drop policy if exists "master admin full access on do_not_call_numbers" on public.do_not_call_numbers;
create policy "master admin full access on do_not_call_numbers"
  on public.do_not_call_numbers for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "customer admin can view own do_not_call_numbers" on public.do_not_call_numbers;
create policy "customer admin can view own do_not_call_numbers"
  on public.do_not_call_numbers for select
  using (customer_id = public.current_customer_id());

-- ---------------------------------------------------------------------------
-- AI campaign contacts and campaigns
-- ---------------------------------------------------------------------------
alter table public.outbound_campaign_contacts
  add column if not exists email text,
  add column if not exists custom_data jsonb not null default '{}'::jsonb,
  -- What the call came to: answered / no_answer / busy / voicemail / failed,
  -- or the agent's own verdict (interested, meeting_booked, …) when its
  -- analysis reports one. Set by the Vapi end-of-call webhook.
  add column if not exists outcome text,
  add column if not exists summary text;

alter table public.outbound_campaigns
  -- Spoken instead of a conversation when the AI reaches a voicemail box.
  -- Null leaves the agent's own voicemail behaviour alone.
  add column if not exists voicemail_message text,
  -- How long to wait before trying again, per outcome, in minutes:
  -- {"no_answer": 240, "busy": 30, "voicemail": 1440, "failed": 60}.
  -- An outcome missing here falls back to retry_after_minutes, so every
  -- campaign created before this keeps exactly the behaviour it had.
  -- Answered calls, wrong numbers and do-not-call are never retried.
  add column if not exists retry_rules jsonb not null default '{}'::jsonb;

create index if not exists idx_campaign_contacts_phone on public.outbound_campaign_contacts (campaign_id, phone_number);

-- "Stop" is not pause: a stopped campaign is over, with whatever was not
-- called yet left uncalled. 'cancelled' says so, rather than borrowing
-- 'completed' for a campaign that did not complete.
alter table public.outbound_campaigns drop constraint if exists outbound_campaigns_status_check;
alter table public.outbound_campaigns
  add constraint outbound_campaigns_status_check
    check (status in ('draft', 'running', 'paused', 'completed', 'failed', 'cancelled'));
