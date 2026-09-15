-- ---------------------------------------------------------------------------
-- Shopify integration: one connected webshop per widget.
--
-- The whole point of this table is that it holds TWO deliberately separate
-- things, and keeping them apart is the design:
--
--   1. The PUBLIC webshop (shop_url, catalog, crawl_* columns). Built by
--      crawling the storefront the same way the knowledge base crawls any
--      other URL — products, prices, variants, shipping/returns/FAQ pages.
--      Nothing here is private, and it works the moment the customer pastes
--      their shop URL, with no Shopify account involved.
--
--   2. The PRIVATE Admin API connection (shop_domain, access_token, scopes,
--      status). Established through Shopify's own OAuth install flow and used
--      for one thing only: looking up a caller's order status and tracking.
--
-- A customer can have (1) without (2) — that's the expected first step of the
-- setup flow — which is why every admin-side column is nullable and `status`
-- starts at 'not_connected'.
--
-- Shape follows calendar_connections (0014_calendar_integrations.sql): scoped
-- to both customer_id and widget_id, service-role writes only, and the token
-- column holds AES-256-GCM ciphertext rather than a usable credential.
-- ---------------------------------------------------------------------------
create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,

  -- (1) Public webshop
  shop_url text,
  catalog jsonb not null default '[]'::jsonb,
  -- The shop's own currency, read from the storefront's meta.json. Prices in
  -- products.json are bare numbers, so without this the agent would quote
  -- "349" with no idea whether that is kroner or euro.
  currency text,
  crawl_status text not null default 'pending'
    check (crawl_status in ('pending', 'running', 'ok', 'error')),
  crawl_error text,
  crawled_product_count integer not null default 0,
  crawled_page_count integer not null default 0,
  last_sync_at timestamptz,

  -- (2) Private Admin API connection
  shop_domain text,
  access_token text,
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

comment on column public.shopify_connections.access_token is
  'AES-256-GCM ciphertext (lib/security/crypto.ts), never plaintext. Never selected back into a client-facing response — the dashboard only ever learns connected/not connected, the shop domain, and the last sync time.';

comment on column public.shopify_connections.catalog is
  'Products from the PUBLIC storefront crawl only (title, price, variants, URL). Never order or customer data — that stays behind the Admin API and is fetched per request, never stored.';

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
