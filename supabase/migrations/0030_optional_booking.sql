-- ---------------------------------------------------------------------------
-- Booking as an opt-in feature.
--
-- widgets.booking_enabled is the single effective flag the runtime reads: the
-- Vapi assistant only carries booking tools, and the tool handler only
-- touches Cal.com, when it's true. The workflow that gets a customer there
-- (our team configuring Cal.com and connecting their calendar) lives in
-- booking_setup_requests, which is the only source of truth for how far along
-- a setup is — deliberately not mirrored onto widget_settings, so the two
-- can't drift.
--
-- Note on the free trial: it is NOT re-implemented here. New customers are
-- already granted 5 minutes as real credit at signup (lib/billing/trial.ts +
-- lib/customers/self-signup.ts), which the widget session route already
-- enforces through the shared credit balance. A second per-widget counter
-- would double-count the same seconds.
--
-- Cal.com's own details (api key, event type, timezone) already live on
-- calendar_connections (0014, 0023) and are not duplicated here.
-- ---------------------------------------------------------------------------

alter table public.widgets
  add column if not exists booking_enabled boolean not null default false;

comment on column public.widgets.booking_enabled is
  'Effective booking feature flag: gates the Vapi booking tools and the Cal.com tool handler.';

-- The flag defaults to false, but booking was already live for one group:
-- provider='anthropic' agents (phone and text) book through
-- lib/conversation/calendar-tools.ts, which until now started the moment a
-- Cal.com calendar was connected. Those agents are switched on here so the
-- new gate changes nothing for anyone already taking bookings — without this
-- backfill, every existing booking setup would silently stop working the
-- moment this migration ran.
update public.widgets w
set booking_enabled = true
where exists (
  select 1
  from public.calendar_connections c
  where c.widget_id = w.id
    and c.provider = 'calcom'
    and c.status = 'connected'
);

-- ---------------------------------------------------------------------------
-- booking_setup_requests: one open setup job per widget. The customer asks
-- for booking from the dashboard; our team does the Cal.com/calendar work
-- and marks it completed, which is what flips widgets.booking_enabled.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_setup_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  request_details jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  assigned_to uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (widget_id)
);

create index if not exists idx_booking_setup_requests_customer_id
  on public.booking_setup_requests (customer_id);
create index if not exists idx_booking_setup_requests_status
  on public.booking_setup_requests (status);

drop trigger if exists set_updated_at on public.booking_setup_requests;
create trigger set_updated_at before update on public.booking_setup_requests
  for each row execute function public.set_updated_at();

alter table public.booking_setup_requests enable row level security;

-- Same shape as calendar_connections' RLS (0014): master admin full access,
-- customer admin read-only — every write goes through a service-role API
-- route so the workflow can't be driven from the browser.
drop policy if exists "master admin full access on booking_setup_requests"
  on public.booking_setup_requests;
create policy "master admin full access on booking_setup_requests"
  on public.booking_setup_requests for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "customer admin can view own booking_setup_requests"
  on public.booking_setup_requests;
create policy "customer admin can view own booking_setup_requests"
  on public.booking_setup_requests for select
  using (customer_id = public.current_customer_id());
