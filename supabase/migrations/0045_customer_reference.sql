-- ---------------------------------------------------------------------------
-- Free-text reference recorded when Master Admin creates a customer (see
-- lib/customers/onboarding.ts) — typically the name of the salesperson who
-- closed the deal, so the client portal can show who sold each customer.
-- Self-signup (lib/customers/self-signup.ts) never sets it, since there is
-- no admin on the other end to attribute the signup to.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists reference text;
