-- ---------------------------------------------------------------------------
-- Aligns the packages table with the pricing actually shown on
-- aibooking.dk: Starter/Professional/Enterprise, each with a one-time
-- setup/onboarding fee on top of the recurring monthly price. The "Demo"
-- tier on the marketing site (free, 7-day trial) isn't a purchasable
-- package row — it's the app-level trial in lib/billing/trial.ts.
--
-- The original seed package (0004_seed.sql, "AIbooking 999" / 150 minutes)
-- becomes Starter here rather than being replaced, so any subscription
-- already pointing at it keeps a valid package_id.
-- ---------------------------------------------------------------------------
alter table public.packages
  add column if not exists setup_fee numeric(10, 2);

update public.packages
set
  package_name = 'Starter',
  monthly_price = 999.00,
  included_minutes = 200,
  setup_fee = 1998.00
where is_default = true and package_name = 'AIbooking 999';

insert into public.packages (package_name, monthly_price, currency, included_minutes, overage_price_per_minute, setup_fee, renewal_type, active, is_default)
values
  ('Professional', 2499.00, 'DKK', 600, 6.66, 4998.00, 'automatic', true, false),
  ('Enterprise', 5999.00, 'DKK', 2000, 6.66, 11998.00, 'automatic', true, false)
on conflict do nothing;
