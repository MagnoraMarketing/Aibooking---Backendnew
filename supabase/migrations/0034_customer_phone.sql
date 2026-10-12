-- ---------------------------------------------------------------------------
-- Phone number on the customer record, asked for (optionally) at self-signup.
--
-- It exists for one reason: the internal "ny kunde" notification that now goes
-- to mail@aibooking.dk (lib/email/internal-notifications.ts) is there so
-- someone can ring a new customer and welcome them — which needs a number to
-- ring. Optional on purpose: a required field on /signup would cost more
-- signups than the occasional missing number is worth, so the notification
-- simply says "ikke oplyst" when it's absent.
--
-- Not to be confused with public.phone_numbers, which is the platform's
-- Twilio inventory (numbers customers *receive calls on*); this is the human
-- contact number for the account itself.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists phone text;
