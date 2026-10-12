-- ---------------------------------------------------------------------------
-- Aibooking.dk Dashboard — the platform's own agents.
--
-- The agents that answer for AIbooking.dk itself (the widget on the website,
-- the inbound phone line, later outbound) are Vapi assistants the admin
-- wants to follow in one place: call history, transcripts, recordings,
-- bookings and statistics. Which assistants those are changes over time —
-- an assistant gets replaced, a new line is added — so they are rows here
-- rather than ids in the code or the environment.
--
-- Nothing on the call path reads this table. It only tells the admin
-- dashboard (app/admin/aibooking) which assistants' calls to fetch from Vapi,
-- so a wrong id here can never break a call — it just shows no activity.
-- ---------------------------------------------------------------------------

create table if not exists public.aibooking_dashboard_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('widget', 'inbound', 'outbound')),
  vapi_assistant_id text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.aibooking_dashboard_agents enable row level security;

create policy "master admin full access on aibooking_dashboard_agents"
  on public.aibooking_dashboard_agents for all
  using (public.is_master_admin())
  with check (public.is_master_admin());

do $$
begin
  execute 'drop trigger if exists set_updated_at on public.aibooking_dashboard_agents; create trigger set_updated_at before update on public.aibooking_dashboard_agents for each row execute function public.set_updated_at();';
end;
$$;

-- The two agents live today. Seeded by channel rather than by id, so an id
-- the admin has since changed in the dashboard is never re-added.
insert into public.aibooking_dashboard_agents (name, channel, vapi_assistant_id, sort_order)
select 'Widget (aibooking.dk)', 'widget', '6e91b6e9-4115-497e-9ebc-180127aae192', 0
where not exists (select 1 from public.aibooking_dashboard_agents where channel = 'widget');

insert into public.aibooking_dashboard_agents (name, channel, vapi_assistant_id, sort_order)
select 'Inbound (telefon)', 'inbound', '4c1d3883-9669-4821-ba09-60241951d3ac', 1
where not exists (select 1 from public.aibooking_dashboard_agents where channel = 'inbound');
