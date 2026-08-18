-- ---------------------------------------------------------------------------
-- Lets BYO-Twilio numbers work for Twilio-direct (provider='anthropic')
-- widgets too — previously only platform-purchased numbers could use that
-- pipeline (see 0019_twilio_direct_voice.sql's known limitation), since
-- request-signature validation needs durable credentials to check against
-- and a BYO import never persisted any. Platform-purchased numbers keep
-- using the per-customer Twilio subaccount (twilio_subaccounts,
-- lib/twilio/subaccounts.ts); BYO numbers now carry their own customer-
-- supplied credentials directly on the row instead, since there's no
-- subaccount to fall back to and a customer's BYO numbers could plausibly
-- come from more than one Twilio account.
--
-- Only populated for source='byo_twilio' rows on a Twilio-direct widget —
-- Vapi-routed BYO numbers (provider='vapi') don't need this, Vapi holds its
-- own copy of the credentials at import time.
-- ---------------------------------------------------------------------------
alter table public.phone_numbers
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token text;
