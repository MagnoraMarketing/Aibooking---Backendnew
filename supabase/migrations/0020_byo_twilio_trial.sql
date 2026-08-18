-- ---------------------------------------------------------------------------
-- "Prøv gratis i 30 dage" — connecting your own Twilio number (BYO) through
-- the Inbound page's risk-free trial flow (just a call-forward, no changes
-- to the customer's real number/setup) grants full PRO access for 30 days,
-- replacing the normal 5-minute/7-day signup trial for that path (see
-- lib/billing/trial.ts). Set once, the first time a customer completes a
-- BYO import — never re-extended by later imports.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists byo_trial_expires_at timestamptz;
