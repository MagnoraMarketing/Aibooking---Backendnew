-- ---------------------------------------------------------------------------
-- Cal.com connections: re-resolve the timezone that was never really read.
--
-- 0026 gave calcom_connections.timezone a default of 'Europe/Copenhagen', and
-- the OAuth callback wrote that same string verbatim on every connect — the
-- account's real timeZone was fetched from Cal.com and then discarded. So the
-- column's value is not the customer's timezone, it is a constant, and every
-- connection made before this migration books in the wrong zone for anyone
-- outside it.
--
-- The callback now stores the real value, but that only helps a customer who
-- reconnects. Instead of asking them to, we mark the existing rows unknown:
-- the column loses its default, and lib/calendar/calcom-token.ts
-- resolves a null by asking Cal.com for the account's timeZone on the next
-- availability or booking call and storing what comes back. A customer who
-- genuinely is in Europe/Copenhagen simply gets that value written back.
--
-- Nothing in the app wrote this column other than that callback, so no
-- deliberate customer choice is discarded here.
-- ---------------------------------------------------------------------------

alter table public.calcom_connections alter column timezone drop default;

update public.calcom_connections set timezone = null;

comment on column public.calcom_connections.timezone is
  'IANA timezone of the connected Cal.com account, used for every availability and booking call. Null means "not resolved yet" — lib/calendar/calcom-token.ts fetches it from Cal.com on next use and stores it.';
