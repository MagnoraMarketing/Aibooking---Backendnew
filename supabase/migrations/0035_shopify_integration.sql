-- ---------------------------------------------------------------------------
-- Shopify integration: one connected store per widget.
--
-- This table holds the OAuth connection and nothing else. No products, no
-- prices, no stock, no policy text, no copy of the storefront.
--
-- That absence is the design. Everything a customer asks about the shop —
-- product names, descriptions, prices, variants, sizes, colours, SKUs, stock,
-- collections, product URLs, delivery and returns policies, order status and
-- tracking — is fetched from the Shopify Admin API at the moment the question
-- is asked, scoped to that question. Nothing is crawled, indexed or cached:
-- prices and stock change, and an agent confidently quoting a stale price is
-- worse than one that looks it up.
--
-- Shape follows calendar_connections (0014_calendar_integrations.sql): scoped
-- to both customer_id and widget_id, service-role writes only, and the token
-- column holds AES-256-GCM ciphertext rather than a usable credential.
-- ---------------------------------------------------------------------------
create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,

  -- The shop's permanent *.myshopify.com domain. The only host an access
  -- token is ever sent to.
  shop_domain text,
  access_token text,
  -- What Shopify actually granted, which is not always what was asked for —
  -- a store connected before a scope was added keeps working without it.
  scopes text,

  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'reauth_required')),
  status_error text,
  connected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (widget_id)
);

create index if not exists idx_shopify_connections_customer_id on public.shopify_connections (customer_id);
create index if not exists idx_shopify_connections_shop_domain on public.shopify_connections (shop_domain);

comment on table public.shopify_connections is
  'One Shopify OAuth connection per widget. Deliberately stores no shop content: products, stock, policies and orders are read live from the Admin API per question, never crawled or cached.';

comment on column public.shopify_connections.access_token is
  'AES-256-GCM ciphertext (lib/security/crypto.ts), never plaintext. Never selected back into a client-facing response — the dashboard only ever learns connected/not connected and the shop domain.';

drop trigger if exists set_updated_at on public.shopify_connections;
create trigger set_updated_at before update on public.shopify_connections
  for each row execute function public.set_updated_at();

alter table public.shopify_connections enable row level security;

-- Same shape as calendar_connections: master admin full access, customer
-- admin read-only. Every write goes through a service-role API route, so the
-- access token never passes through the browser's Supabase client.
create policy "master admin full access on shopify_connections"
  on public.shopify_connections for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own shopify_connections"
  on public.shopify_connections for select
  using (customer_id = public.current_customer_id());

-- ---------------------------------------------------------------------------
-- CSRF state for the Shopify OAuth round-trip. Stored in the database rather
-- than a cookie (the pattern calcom_oauth_states established in
-- 0026_calcom_oauth.sql) because the merchant may well approve the install in
-- a different tab — or after logging into Shopify, which can drop a
-- SameSite=Lax cookie on the way back.
--
-- Binding widget_id here, rather than reading it out of the callback URL, is
-- what stops a forged callback from attaching someone else's shop to a widget
-- the caller doesn't own.
-- ---------------------------------------------------------------------------
create table if not exists public.shopify_oauth_states (
  state_hash text primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  shop_domain text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);

create index if not exists idx_shopify_oauth_states_expires_at on public.shopify_oauth_states (expires_at);

comment on table public.shopify_oauth_states is
  'Temporary CSRF state for the Shopify OAuth install flow. Valid for 10 minutes, deleted on callback.';

alter table public.shopify_oauth_states enable row level security;

create policy "master admin full access on shopify_oauth_states"
  on public.shopify_oauth_states for all
  using (public.is_master_admin())
  with check (public.is_master_admin());
