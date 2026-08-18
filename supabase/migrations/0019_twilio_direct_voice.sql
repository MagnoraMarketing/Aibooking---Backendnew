-- ---------------------------------------------------------------------------
-- "Twilio-direct" voice: a second phone/voice architecture alongside Vapi,
-- for customers who want calls handled by Twilio + Claude directly instead
-- of through Vapi's orchestration. Reuses the existing provider='anthropic'
-- llm_models row (previously "Standard model", text-widget only, hidden
-- from the create flow since 0012_vapi_default_model.sql) rather than
-- adding a new provider value — handleConversationTurn already works
-- unmodified for provider='anthropic' widgets, on both channels:
--   - web widget: already routes to "text" mode (resolveMode falls through
--     for any provider that isn't 'openai'/'vapi') — Claude + ElevenLabs,
--     same as before, now also reachable from the create flow again.
--   - phone: newly wired up in lib/telephony + app/api/telephony/twilio/*,
--     turn-based via Twilio's <Gather input="speech"> (built-in ASR) and
--     <Play> of an ElevenLabs-synthesized reply — no Vapi assistant, no
--     WebSocket media-streaming server (see lib/telephony's module comment
--     for the deliberate scope cut vs. real-time streaming).
-- ---------------------------------------------------------------------------
update public.llm_models
set show_in_create_flow = true, display_name = 'Claude (Twilio telefon + widget)'
where model_name = 'claude-sonnet-5';

-- Distinguishes a phone-originated conversation from a web-widget one —
-- both share the same conversations/conversation_messages/usage_sessions
-- pipeline (see lib/conversation/handle-turn.ts), so this is purely
-- informational (dashboard/analytics can filter by it later) rather than
-- something the pipeline itself branches on.
alter table public.conversations
  add column if not exists channel text not null default 'widget' check (channel in ('widget', 'phone')),
  add column if not exists twilio_call_sid text;

create unique index if not exists idx_conversations_twilio_call_sid
  on public.conversations (twilio_call_sid)
  where twilio_call_sid is not null;

-- Holds the ElevenLabs audio for a phone-channel assistant turn just long
-- enough for Twilio's <Play> fetch to retrieve it (see
-- app/api/telephony/twilio/audio/[messageId]/route.ts) — null for every
-- web-widget message, which never needs a fetchable audio URL.
alter table public.conversation_messages
  add column if not exists audio_base64 text;
