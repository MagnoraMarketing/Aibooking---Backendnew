-- ---------------------------------------------------------------------------
-- "Vapi model" — a third customer-facing voice option alongside Standard
-- (Claude + ElevenLabs) and Expert (OpenAI Realtime, see
-- 0007_realtime_model.sql). Widgets using a provider='vapi' model are routed
-- through lib/vapi instead of lib/llm+lib/tts or lib/realtime — see
-- toPublicWidgetConfig's `mode` field and app/api/widget/session/route.ts.
--
-- Unlike OpenAI Realtime, Vapi calls are driven entirely client-side by the
-- Vapi Web SDK once it has a public key + assistant id — the assistant
-- itself is configured per-widget in the Vapi dashboard/API and its id is
-- stored in widget_settings.extra->>'vapiAssistantId' (see
-- lib/security/schemas.ts's widgetExtraSettingsSchema), not in this table,
-- since llm_models rows are shared across every customer's widgets.
--
-- Cost columns are left at 0 for the same reason as the Expert model row:
-- Vapi bills per call-minute against its own account, not per token, and
-- customer billing here is always flat per-minute against the package
-- regardless of backend provider cost.
-- ---------------------------------------------------------------------------

insert into public.llm_models (provider, model_name, display_name, input_price_per_million, output_price_per_million, max_tokens, active, is_default, show_in_create_flow)
values ('vapi', 'vapi-voice-agent', 'Vapi model', 0, 0, 1024, true, false, true)
on conflict (model_name) do nothing;

-- ---------------------------------------------------------------------------
-- vapi_events — raw log of inbound Vapi webhook deliveries (app/api/webhooks
-- /vapi/route.ts). Unlike stripe_events, this is not a strict idempotency
-- gate: Vapi fires high-frequency events per call (status-update, transcript
-- chunks, etc.) rather than Stripe's one-shot billing events, so there's no
-- single natural "already processed" key to dedupe on. It exists for
-- audit/debugging of call events, keyed by Vapi's call id.
-- ---------------------------------------------------------------------------
create table if not exists public.vapi_events (
  id uuid primary key default gen_random_uuid(),
  call_id text,
  type text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_vapi_events_call_id on public.vapi_events (call_id);

-- service_role only; no policies -> RLS denies all others (same pattern as
-- stripe_events, see 0003_rls.sql).
alter table public.vapi_events enable row level security;
