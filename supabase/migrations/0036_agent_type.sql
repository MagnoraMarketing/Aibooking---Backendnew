-- ---------------------------------------------------------------------------
-- widgets.agent_type — what an agent IS, stated instead of inferred.
--
-- Until now the platform read an agent's type off its LLM model: provider
-- 'anthropic' meant "Telefon" (Inbound/Outbound/Dialer), anything else meant
-- "Voice Widget". That held only while the two types happened to run on
-- different engines, and eight call sites quietly depended on it
-- (app/dashboard/{agent,inbound,outbound}/page.tsx,
-- lib/analytics/usage-by-agent-type.ts, components/dashboard/
-- agent-configurator.tsx, and the routes that provision phone numbers).
--
-- Inbound now always answers through a Vapi assistant (see
-- lib/phone-numbers/service.ts and app/api/customer/phone-numbers/route.ts):
-- the direct Twilio/TwiML pipeline is no longer offered for an inbound
-- number, because it answers calls with no Vapi assistant behind it at all.
-- That makes new phone agents Vapi-backed like widget agents, and the
-- provider stops saying anything about which list an agent belongs in.
--
-- The backfill reproduces exactly what the old inference returned, so every
-- existing agent stays on the page it was already on. 'widget' is the default
-- because that is what the inference returned for everything that wasn't
-- Anthropic — including a widget with no model at all.
-- ---------------------------------------------------------------------------

alter table public.widgets
  add column if not exists agent_type text not null default 'widget';

update public.widgets w
   set agent_type = 'phone'
  from public.llm_models m
 where w.llm_model_id = m.id
   and m.provider = 'anthropic'
   and w.agent_type <> 'phone';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'widgets_agent_type_check'
  ) then
    alter table public.widgets
      add constraint widgets_agent_type_check check (agent_type in ('widget', 'phone'));
  end if;
end $$;

-- Every page that lists agents filters on this, per customer.
create index if not exists idx_widgets_customer_agent_type
  on public.widgets (customer_id, agent_type);
