-- ---------------------------------------------------------------------------
-- Two customer-facing options in the create-agent flow: "Standard model"
-- (Claude Sonnet, text + ElevenLabs TTS) and "Expert model" (OpenAI
-- Realtime over WebRTC, see 0007_realtime_model.sql). `is_default` stays a
-- single row (enforced by the admin llm-models routes) and keeps meaning
-- "the system default when nothing else is specified" — it is not the same
-- thing as "shown in the create-agent picker", hence the separate column.
-- ---------------------------------------------------------------------------

alter table public.llm_models
  add column if not exists show_in_create_flow boolean not null default false;

update public.llm_models set show_in_create_flow = true
  where model_name in ('claude-sonnet-5', 'gpt-realtime-2.1');

update public.llm_models set display_name = 'Standard model'
  where model_name = 'claude-sonnet-5';

-- Rolling conversation summaries always use Claude Sonnet regardless of the
-- widget's own model, for cost/quality consistency (see
-- lib/settings/platform.ts's getSummarizationModelName + its use in
-- lib/conversation/handle-turn.ts). Admin-configurable, not hardcoded.
insert into public.platform_settings (key, value)
values ('summarization_model_name', '"claude-sonnet-5"'::jsonb)
on conflict (key) do nothing;
