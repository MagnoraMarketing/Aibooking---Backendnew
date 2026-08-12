-- ---------------------------------------------------------------------------
-- "Expert model" — OpenAI's Realtime API (speech-to-speech over WebRTC),
-- offered alongside the existing Claude + ElevenLabs text/TTS pipeline.
-- Widgets using a provider='openai' model are routed through
-- lib/realtime instead of lib/llm + lib/tts (see toPublicWidgetConfig's
-- `mode` field and app/api/widget/session/route.ts).
--
-- Cost columns are left at 0: OpenAI Realtime bills per audio-minute, not
-- per token, so the existing per-million-token cost fields don't apply.
-- Customer billing is unaffected either way — it's always flat per-minute
-- against the package, regardless of backend model cost.
-- ---------------------------------------------------------------------------

update public.llm_models set is_default = false where is_default = true;

insert into public.llm_models (provider, model_name, display_name, input_price_per_million, output_price_per_million, max_tokens, active, is_default)
values ('openai', 'gpt-realtime-2.1', 'Expert model', 0, 0, 1024, true, true)
on conflict (model_name) do nothing;
