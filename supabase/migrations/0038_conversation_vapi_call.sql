-- Ties a conversation to the Vapi call it was held on.
--
-- Everything the dashboard's "Samtaledetaljer" promises — transcript,
-- summary, recording — already arrives in the end-of-call-report we store in
-- vapi_events, and has since the first Vapi call. What was missing was the
-- one link: a conversation row knew its widget and its minutes, but not
-- which call produced it, so all three tabs sat empty on every voice
-- conversation the platform has ever had.
--
-- The id is written by the webhook when the call ends (see
-- app/api/webhooks/vapi). The browser cannot supply it — Vapi's script-tag
-- SDK does not hand the call id to its call-start listener — so the report
-- is matched to the conversation the widget opened just before the call
-- started, and only when exactly one candidate fits that window.
alter table conversations
  add column if not exists vapi_call_id text;

-- The details endpoint looks the report up by this, and the unique index
-- keeps one call from being claimed by two conversations.
create unique index if not exists conversations_vapi_call_id_key
  on conversations (vapi_call_id)
  where vapi_call_id is not null;
