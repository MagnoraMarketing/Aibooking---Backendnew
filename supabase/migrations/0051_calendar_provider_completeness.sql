-- ---------------------------------------------------------------------------
-- Makes Google Calendar and Outlook real, working booking backends instead
-- of connect-only stubs. Until now `calendar_connections` stored Google/
-- Outlook OAuth tokens (0014_calendar_integrations.sql) but nothing ever
-- read them for a live call — lib/vapi/booking-tools.ts and
-- lib/conversation/calendar-tools.ts both hardcoded provider='calcom'. This
-- migration adds what those two providers need that Cal.com doesn't:
--
-- - calendar_connections.default_duration_minutes: Cal.com has "event
--   types" with their own duration; Google/Outlook have no such concept, so
--   the customer picks a fixed meeting length instead (surfaced next to the
--   existing Cal.com event-type picker in the calendar integrations page).
-- - appointments.calendar_provider / external_event_id: a generic
--   equivalent of calcom_booking_uid/calcom_booking_id
--   (0032_appointment_calcom_link.sql) so a Google/Outlook booking can be
--   found again for reschedule/cancel. Kept separate from the calcom-
--   specific columns rather than repurposing them — app/api/webhooks/calcom
--   matches on calcom_booking_uid specifically and must keep working
--   unchanged.
--
-- No backfill needed for either: no booking has ever gone through Google or
-- Outlook (the tool layer never called them), so there's nothing to convert.
-- ---------------------------------------------------------------------------

alter table public.calendar_connections
  add column if not exists default_duration_minutes integer not null default 30;

comment on column public.calendar_connections.default_duration_minutes is
  'Meeting length in minutes for provider in (google, outlook), which have no event-type concept. Ignored for calcom.';

comment on column public.calendar_connections.access_token is
  'AES-256-GCM ciphertext (lib/security/crypto.ts) for provider in (google, outlook). Never plaintext and never selected back into a client-facing response.';
comment on column public.calendar_connections.refresh_token is
  'AES-256-GCM ciphertext (lib/security/crypto.ts) for provider in (google, outlook). Never plaintext and never selected back into a client-facing response.';

alter table public.appointments
  add column if not exists calendar_provider text check (calendar_provider in ('google', 'outlook', 'calcom')),
  add column if not exists external_event_id text;

create unique index if not exists appointments_external_event_id_key
  on public.appointments (calendar_provider, external_event_id)
  where calendar_provider is not null and external_event_id is not null;

comment on column public.appointments.calendar_provider is
  'Which calendar this booking was made in — null for rows predating this column (all calcom, tracked via calcom_booking_uid instead).';
comment on column public.appointments.external_event_id is
  'Google event id / Outlook event id — the join key for finding a booking again to reschedule or cancel it. Cal.com continues to use calcom_booking_uid.';
