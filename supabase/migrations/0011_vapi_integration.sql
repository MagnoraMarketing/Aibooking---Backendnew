-- ---------------------------------------------------------------------------
-- Vapi integration: lets a widget (an "AI agent" in the dashboard) be backed
-- by a real Vapi voice/chat assistant instead of (or alongside) the existing
-- custom Anthropic+ElevenLabs text pipeline. Additive only — every new
-- column is nullable/defaulted so existing widgets and the existing
-- /api/widget/* pipeline are completely unaffected. A widget is "Vapi-backed"
-- once vapi_assistant_id is set; the dashboard's Voice Agent tab is what
-- sets it (see app/api/customer/widgets/[id]/vapi).
-- ---------------------------------------------------------------------------

alter table public.widgets
  add column if not exists vapi_assistant_id text unique,
  add column if not exists vapi_voice_provider text,
  add column if not exists vapi_voice_id text,
  add column if not exists vapi_llm_provider text not null default 'openai',
  add column if not exists vapi_llm_model text not null default 'gpt-4o-mini',
  add column if not exists widget_mode text not null default 'voice' check (widget_mode in ('voice', 'chat', 'both')),
  add column if not exists widget_theme text not null default 'light' check (widget_theme in ('light', 'dark')),
  add column if not exists business_description text,
  add column if not exists business_phone text,
  add column if not exists business_email text,
  add column if not exists website_url text,
  add column if not exists vapi_synced_at timestamptz;

create index if not exists idx_widgets_vapi_assistant_id on public.widgets (vapi_assistant_id);

-- ---------------------------------------------------------------------------
-- vapi_calls: call metadata reported by Vapi webhooks (POST /api/webhooks/vapi).
-- Mirrors the shape of usage_sessions/conversations but is populated purely
-- from Vapi's own events, since Vapi-backed calls never touch our
-- lib/conversation turn-handling pipeline. Kept as its own table (rather than
-- overloading usage_sessions, whose columns/semantics are tied to the
-- second-by-second custom-pipeline billing model) so the two engines never
-- have to agree on a shared row shape.
-- ---------------------------------------------------------------------------
create table if not exists public.vapi_calls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  widget_id uuid references public.widgets (id) on delete set null,
  vapi_call_id text not null unique,
  vapi_assistant_id text not null,
  status text,
  ended_reason text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  cost numeric(10, 4),
  transcript text,
  summary text,
  recording_url text,
  customer_phone_number text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vapi_calls_customer_id on public.vapi_calls (customer_id, created_at desc);
create index if not exists idx_vapi_calls_widget_id on public.vapi_calls (widget_id);
create index if not exists idx_vapi_calls_vapi_assistant_id on public.vapi_calls (vapi_assistant_id);

alter table public.vapi_calls enable row level security;

create policy "master admin full access on vapi_calls"
  on public.vapi_calls for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

create policy "customer admin can view own vapi_calls"
  on public.vapi_calls for select
  using (customer_id = public.current_customer_id());

drop trigger if exists set_updated_at on public.vapi_calls;
create trigger set_updated_at before update on public.vapi_calls
  for each row execute function public.set_updated_at();
