-- ---------------------------------------------------------------------------
-- Platform-purchased phone numbers: until now a customer had to bring their
-- own Twilio account to get an inbound number (see 0013_phone_calling.sql).
-- This adds the alternative most customers actually want — buy a number
-- through us. We hold one Twilio master account; `source` records which
-- path a given row came from, `twilio_sid` is that Twilio
-- IncomingPhoneNumber's SID (needed to release/manage it later), and
-- `monthly_price_dkk` is what we charged for it at purchase time (Twilio's
-- number rental price varies by country/type, so this isn't a constant).
-- ---------------------------------------------------------------------------
alter table public.phone_numbers
  add column if not exists source text not null default 'byo_twilio'
    check (source in ('byo_twilio', 'platform_twilio')),
  add column if not exists twilio_sid text,
  add column if not exists monthly_price_dkk numeric(10, 2);

create unique index if not exists idx_phone_numbers_twilio_sid
  on public.phone_numbers (twilio_sid)
  where twilio_sid is not null;
