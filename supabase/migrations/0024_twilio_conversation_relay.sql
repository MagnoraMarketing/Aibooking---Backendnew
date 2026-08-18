-- ---------------------------------------------------------------------------
-- Twilio ConversationRelay voice widget — a second Voice Widget engine
-- alongside Vapi (provider='vapi'). Twilio's ConversationRelay handles STT/TTS
-- for a call placed from the browser via the Twilio Voice SDK; AIbooking's own
-- backend still owns AI reasoning, knowledge base and Cal.com booking, via the
-- exact same handleConversationTurn/generateConversationReplyText path the
-- Twilio-direct phone pipeline already uses (see lib/conversation/handle-turn.ts
-- and lib/llm/registry.ts).
--
-- 'claude-haiku-4-5-20251001' is the full dated Anthropic model id for Haiku
-- 4.5 — distinct from the 'claude-haiku-4-5' alias already seeded by
-- 0004_seed.sql (model_name is globally unique, not composite with provider,
-- so this row needs its own real, valid model string). Haiku is the
-- deliberate choice here: a realtime voice relay benefits more from low
-- latency than from Opus/Sonnet's extra capability.
-- ---------------------------------------------------------------------------
insert into public.llm_models (provider, model_name, display_name, input_price_per_million, output_price_per_million, max_tokens, active, is_default, show_in_create_flow)
values ('twilio_relay', 'claude-haiku-4-5-20251001', 'Claude (Twilio Voice Relay)', 6.50, 32.50, 1024, true, false, true)
on conflict (model_name) do nothing;
