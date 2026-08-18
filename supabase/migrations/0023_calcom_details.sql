-- ---------------------------------------------------------------------------
-- Adds what the Cal.com dashboard card needs beyond what 0014 already
-- stores: the account's timezone (for both display and the booking API
-- calls, which need a timeZone parameter), and marks calcom_api_key's new
-- meaning now that lib/security/crypto.ts encrypts it before insert — old
-- rows (if any) predate encryption and won't decrypt; there are no
-- production Cal.com connections yet, so no backfill is needed.
-- ---------------------------------------------------------------------------
alter table public.calendar_connections
  add column if not exists calcom_timezone text;

comment on column public.calendar_connections.calcom_api_key is
  'AES-256-GCM ciphertext (lib/security/crypto.ts), never plaintext and never selected back into a client-facing response.';
