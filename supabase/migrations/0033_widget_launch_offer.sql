-- ---------------------------------------------------------------------------
-- Voice Widget launch offer: the creation wizard now ends in Test -> Payment,
-- where the customer buys a one-off block of 200 Voice Widget minutes through
-- a Stripe Payment Link (lib/billing/widget-launch.ts). It isn't a
-- subscription, so nothing lands in public.subscriptions and
-- hasEmbedCodeAccess had no way to see it — this column records the purchase
-- so the embed code stays unlocked afterwards, and so the grant can never be
-- mistaken for a renewable one.
--
-- The minutes themselves go on the normal credit ledger (a
-- credit_transactions row keyed by the Stripe event/session id, which the
-- existing uniq_credit_transactions_stripe_event_id index makes idempotent);
-- this timestamp only marks *that* the launch offer was paid, and when.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists widget_launch_paid_at timestamptz;
