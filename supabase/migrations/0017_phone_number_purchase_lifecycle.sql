-- ---------------------------------------------------------------------------
-- Payment-gated purchase lifecycle for platform-bought numbers (see
-- lib/phone-numbers/service.ts and app/api/customer/phone-numbers/checkout):
-- a row is created as 'pending_payment' before Stripe checkout, flips to
-- 'payment_confirmed' by the Stripe webhook, then 'provisioning' while the
-- Twilio purchase + Vapi import run, ending at 'active' or 'failed'.
-- 'released' is the terminal state for a number the customer gave up —
-- kept (not deleted) so purchase history survives.
--
-- Existing rows (every row before this migration — BYO imports and numbers
-- bought under the pre-payment-gate flow) are already live and paid for one
-- way or another, so they default straight to 'active' rather than being
-- swept into the new pending states.
--
-- direction records what the number is used for; existing rows default to
-- 'both' to preserve current behavior (nothing enforced direction before
-- this migration).
-- ---------------------------------------------------------------------------
-- A row now exists before the Twilio purchase happens (created as
-- 'pending_payment' at Stripe Checkout time — see
-- app/api/customer/phone-numbers/purchase/route.ts), so the Vapi phone
-- number id it's imported under can no longer be required at insert time.
alter table public.phone_numbers alter column vapi_phone_number_id drop not null;

alter table public.phone_numbers
  add column if not exists purchase_status text not null default 'active'
    check (purchase_status in ('pending_payment', 'payment_confirmed', 'provisioning', 'active', 'failed', 'released')),
  add column if not exists direction text not null default 'both'
    check (direction in ('inbound', 'outbound', 'both')),
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists failure_reason text,
  add column if not exists released_at timestamptz;

create unique index if not exists idx_phone_numbers_stripe_checkout_session_id
  on public.phone_numbers (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
