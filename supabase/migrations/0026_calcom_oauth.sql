-- ---------------------------------------------------------------------------
-- Cal.com OAuth integration: customer-level connections with refresh token
-- handling. One customer can connect their own Cal.com account and select
-- their preferred event type. All widgets under the customer can use this
-- connection for booking operations.
--
-- Design:
-- - Per customer (not per widget, unlike calendar_connections)
-- - OAuth tokens stored encrypted (lib/security/crypto.ts)
-- - Refresh token handling for token expiry
-- - RLS to ensure users only see their own customer's connection
-- - State parameter stored temporarily during OAuth flow (see lib/calendar/calcom-oauth.ts)
-- ---------------------------------------------------------------------------

create table if not exists public.calcom_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers (id) on delete cascade,

  -- Cal.com user details
  calcom_user_id text not null,
  calcom_username text not null,
  calcom_email text not null,

  -- OAuth tokens (both encrypted before insert, never selected back to client)
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,

  -- Event type selection (which event type bookings default to)
  calcom_event_type_id text,
  calcom_event_type_name text,

  -- Timezone for availability/booking operations
  timezone text default 'Europe/Copenhagen',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calcom_connections_customer_id on public.calcom_connections (customer_id);

drop trigger if exists set_updated_at on public.calcom_connections;
create trigger set_updated_at before update on public.calcom_connections
  for each row execute function public.set_updated_at();

alter table public.calcom_connections enable row level security;

-- Master admin has full access
create policy "master admin full access on calcom_connections"
  on public.calcom_connections for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

-- Customer admin can only see their own connection
create policy "customer admin can view own calcom_connection"
  on public.calcom_connections for select
  using (customer_id = public.current_customer_id());

-- Service-role API routes handle all mutations (never client-side)
comment on column public.calcom_connections.access_token is
  'AES-256-GCM ciphertext (lib/security/crypto.ts), never plaintext and never selected back into a client-facing response.';

comment on column public.calcom_connections.refresh_token is
  'AES-256-GCM ciphertext (lib/security/crypto.ts), may be null if Cal.com OAuth response did not include one, never plaintext and never selected back into a client-facing response.';

-- Temporary OAuth state storage for CSRF protection (cleaned up after callback)
create table if not exists public.calcom_oauth_states (
  state_hash text primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);

create index if not exists idx_calcom_oauth_states_expires_at on public.calcom_oauth_states (expires_at);

comment on table public.calcom_oauth_states is
  'Temporary CSRF state for Cal.com OAuth flow. Each state is valid for 10 minutes. Cleaned up after callback or manual cleanup of expired entries.';
