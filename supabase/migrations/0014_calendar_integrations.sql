-- ---------------------------------------------------------------------------
-- calendar_connections: one connected calendar per (widget, provider) so an
-- agent can check availability / create bookings during a call. Three
-- providers cover the common cases for a Danish business: Google Calendar
-- and Microsoft 365/Outlook (the two dominant business calendars in DK),
-- plus Cal.com (API-key based, no OAuth). OAuth tokens live here rather than
-- widget_settings.extra because they're sensitive and have their own
-- lifecycle (refresh/expiry), unlike the free-form display settings.
--
-- Nothing in the conversation pipeline reads this table yet (same "wired for
-- later" status appointments started in 0010_appointments.sql) — this
-- migration lands the connect/disconnect setup flow; using the connection
-- during a live call is a follow-up.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook', 'calcom')),
  status text not null default 'connected' check (status in ('connected', 'error')),
  external_account_email text,
  calendar_id text,
  -- OAuth (google, outlook) — null for calcom.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  -- Cal.com (API key, no OAuth) — null for google/outlook.
  calcom_api_key text,
  calcom_event_type_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (widget_id, provider)
);

create index if not exists idx_calendar_connections_customer_id on public.calendar_connections (customer_id);
create index if not exists idx_calendar_connections_widget_id on public.calendar_connections (widget_id);

drop trigger if exists set_updated_at on public.calendar_connections;
create trigger set_updated_at before update on public.calendar_connections
  for each row execute function public.set_updated_at();

alter table public.calendar_connections enable row level security;

-- Same shape as phone_numbers' RLS (0013_phone_calling.sql): master admin
-- full access, customer admin read-only (all writes go through service-role
-- API routes so OAuth token handling never touches the browser client).
create policy "master admin full access on calendar_connections"
  on public.calendar_connections for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own calendar_connections"
  on public.calendar_connections for select
  using (customer_id = public.current_customer_id());
