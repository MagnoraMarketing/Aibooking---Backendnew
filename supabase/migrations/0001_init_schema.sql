-- AIbooking.dk - core schema
-- Multi-tenant SaaS: Master Admin -> Customers -> Widgets -> Conversations -> Usage/Credits

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('MASTER_ADMIN', 'CUSTOMER_ADMIN')),
  customer_id uuid references public.customers (id) on delete set null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_admin_requires_customer
    check (role = 'MASTER_ADMIN' or customer_id is not null)
);

-- ---------------------------------------------------------------------------
-- packages (admin-configurable pricing, replaces hardcoded 999/150)
-- ---------------------------------------------------------------------------
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  package_name text not null,
  monthly_price numeric(10, 2) not null,
  currency text not null default 'DKK',
  included_minutes integer not null,
  overage_price_per_minute numeric(10, 2) not null default 0,
  renewal_type text not null default 'automatic' check (renewal_type in ('automatic', 'manual')),
  stripe_price_id text,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- subscriptions (local cache of Stripe subscription state)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  package_id uuid not null references public.packages (id),
  stripe_subscription_id text unique,
  stripe_customer_id text,
  status text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- credit_accounts (cached balance; source of truth is credit_transactions)
-- ---------------------------------------------------------------------------
create table if not exists public.credit_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers (id) on delete cascade,
  balance_seconds bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- llm_models (admin-configurable, not hardcoded in frontend)
-- ---------------------------------------------------------------------------
create table if not exists public.llm_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'anthropic',
  model_name text not null unique,
  display_name text not null,
  input_price_per_million numeric(10, 4) not null default 0,
  output_price_per_million numeric(10, 4) not null default 0,
  max_tokens integer not null default 1024,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- voice_models (admin-configurable danish voices)
-- ---------------------------------------------------------------------------
create table if not exists public.voice_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'elevenlabs',
  provider_voice_id text not null,
  name text not null,
  language text not null default 'da',
  gender text,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- widgets
-- ---------------------------------------------------------------------------
create table if not exists public.widgets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  public_id text not null unique,
  name text not null default 'Main widget',
  status text not null default 'active' check (status in ('active', 'paused')),
  business_name text,
  llm_model_id uuid references public.llm_models (id),
  voice_model_id uuid references public.voice_models (id),
  language text not null default 'da',
  system_prompt text,
  welcome_message text,
  opening_message text,
  primary_color text not null default '#4F46E5',
  secondary_color text not null default '#111827',
  logo_url text,
  avatar_url text,
  position text not null default 'bottom-right',
  widget_size text not null default 'medium',
  show_branding boolean not null default true,
  max_response_chars integer not null default 400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- widget_settings (1:1 extensible settings; jsonb keeps future features
-- like booking/calendar/CRM/knowledge-base migration-free)
-- ---------------------------------------------------------------------------
create table if not exists public.widget_settings (
  widget_id uuid primary key references public.widgets (id) on delete cascade,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversation_messages
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  token_count integer,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversation_summaries (rolling summary to cap LLM context size/cost)
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  summary text not null,
  summarized_through_message_id uuid references public.conversation_messages (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- usage_sessions (one per voice session)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid not null references public.widgets (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  billed_duration_seconds integer not null default 0,
  llm_model text,
  tts_provider text,
  voice_model text,
  estimated_llm_cost numeric(10, 4) not null default 0,
  estimated_tts_cost numeric(10, 4) not null default 0,
  credit_cost_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- credit_transactions (append-only ledger; balance = SUM(amount_seconds))
-- ---------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  credit_account_id uuid not null references public.credit_accounts (id) on delete cascade,
  amount_seconds bigint not null,
  type text not null check (type in ('subscription_credit', 'usage', 'manual_adjustment', 'refund', 'expiration')),
  description text,
  usage_session_id uuid references public.usage_sessions (id) on delete set null,
  stripe_event_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- api_usage (per-request cost tracking for LLM + TTS)
-- ---------------------------------------------------------------------------
create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid references public.widgets (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  usage_session_id uuid references public.usage_sessions (id) on delete set null,
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  characters_used integer,
  estimated_cost numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_logs (never store API keys / secrets / raw payloads with secrets)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role text,
  customer_id uuid references public.customers (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- stripe_events (webhook idempotency ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_profiles_customer_id on public.profiles (customer_id);

create index if not exists idx_subscriptions_customer_id on public.subscriptions (customer_id);
create index if not exists idx_subscriptions_created_at on public.subscriptions (created_at);

create index if not exists idx_widgets_customer_id on public.widgets (customer_id);
create index if not exists idx_widgets_public_id on public.widgets (public_id);
create index if not exists idx_widgets_created_at on public.widgets (created_at);

create index if not exists idx_conversations_widget_id on public.conversations (widget_id);
create index if not exists idx_conversations_customer_id on public.conversations (customer_id);
create index if not exists idx_conversations_created_at on public.conversations (created_at);

create index if not exists idx_conversation_messages_conversation_id on public.conversation_messages (conversation_id);
create index if not exists idx_conversation_messages_created_at on public.conversation_messages (created_at);

create index if not exists idx_conversation_summaries_conversation_id on public.conversation_summaries (conversation_id);

create index if not exists idx_usage_sessions_customer_id on public.usage_sessions (customer_id);
create index if not exists idx_usage_sessions_widget_id on public.usage_sessions (widget_id);
create index if not exists idx_usage_sessions_conversation_id on public.usage_sessions (conversation_id);
create index if not exists idx_usage_sessions_created_at on public.usage_sessions (created_at);

create index if not exists idx_credit_transactions_customer_id on public.credit_transactions (customer_id);
create index if not exists idx_credit_transactions_credit_account_id on public.credit_transactions (credit_account_id);
create index if not exists idx_credit_transactions_created_at on public.credit_transactions (created_at);
create index if not exists idx_credit_transactions_stripe_event_id on public.credit_transactions (stripe_event_id);

create index if not exists idx_api_usage_customer_id on public.api_usage (customer_id);
create index if not exists idx_api_usage_widget_id on public.api_usage (widget_id);
create index if not exists idx_api_usage_conversation_id on public.api_usage (conversation_id);
create index if not exists idx_api_usage_created_at on public.api_usage (created_at);

create index if not exists idx_audit_logs_customer_id on public.audit_logs (customer_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'profiles', 'packages', 'subscriptions', 'credit_accounts',
    'llm_models', 'voice_models', 'widgets', 'widget_settings',
    'conversations', 'usage_sessions'
  ]
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I; create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end;
$$;
