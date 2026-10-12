-- ---------------------------------------------------------------------------
-- Admin Wapi (Vapi) Control Center.
--
-- Adds a local cache of the Vapi assistants the platform account owns
-- (wapi_agents) so the admin "Voice Widgets" / "Inbound" / "Wapi Agents"
-- pages can offer a searchable picker instead of forcing every admin to
-- paste a raw assistant id — while the actual agent that answers a call is,
-- as before, whichever assistant widget_settings.extra.vapiAssistantId
-- points at (see lib/vapi/sync.ts). widgets.wapi_agent_id is a *display/FK*
-- convenience on top of that same value, kept in sync by the admin routes
-- that write it (lib/admin/widget-service.ts) — it is never read by the
-- call-answering path itself, so a stale row here can never break a call.
--
-- Also adds widgets.deployment_type (customer_website vs aibooking_website)
-- and a reserved, non-billed "AIbooking.dk" customer row so the platform's
-- own website widget can be a normal widgets row — reusing every existing
-- customer-scoped table (conversations, usage_sessions, phone_numbers, ...)
-- instead of making customer_id nullable across the schema.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- wapi_agents — local cache of Vapi assistants, refreshed by "Sync Wapi
-- Agents" (lib/vapi/agent-sync.ts). Never deleted by a sync: an assistant
-- that disappears from Vapi just stops being refreshed, so any widget still
-- pointing at it keeps a readable name in the admin UI.
-- ---------------------------------------------------------------------------
create table if not exists public.wapi_agents (
  id uuid primary key default gen_random_uuid(),
  wapi_agent_id text not null unique,
  name text,
  status text,
  language text,
  voice text,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wapi_agents_name on public.wapi_agents (name);

alter table public.wapi_agents enable row level security;

create policy "master admin full access on wapi_agents"
  on public.wapi_agents for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

do $$
begin
  execute 'drop trigger if exists set_updated_at on public.wapi_agents; create trigger set_updated_at before update on public.wapi_agents for each row execute function public.set_updated_at();';
end;
$$;

-- ---------------------------------------------------------------------------
-- widgets: which cached Wapi agent this agent is currently connected to
-- (display convenience, see header comment), and where it is deployed.
-- ---------------------------------------------------------------------------
alter table public.widgets
  add column if not exists wapi_agent_id uuid references public.wapi_agents (id) on delete set null,
  add column if not exists deployment_type text not null default 'customer_website';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'widgets_deployment_type_check'
  ) then
    alter table public.widgets
      add constraint widgets_deployment_type_check
      check (deployment_type in ('customer_website', 'aibooking_website'));
  end if;
end;
$$;

create index if not exists idx_widgets_wapi_agent_id on public.widgets (wapi_agent_id);
create index if not exists idx_widgets_deployment_type on public.widgets (deployment_type);

-- ---------------------------------------------------------------------------
-- customers: a reserved flag for the internal "AIbooking.dk" account that
-- owns the platform's own website widget(s) — never a real paying tenant,
-- excluded from customer-facing lists/stats the same way status='deleted'
-- already is.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists is_platform_owned boolean not null default false;

-- Idempotent seed: only inserted once, matched by the flag itself rather
-- than a guessable email, so re-running this migration never creates a
-- second row.
insert into public.customers (name, email, status, is_platform_owned)
select 'AIbooking.dk (egen widget)', 'internal-aibooking-website@aibooking.dk', 'active', true
where not exists (select 1 from public.customers where is_platform_owned = true);
