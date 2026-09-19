-- 0018_package_pricing_update.sql aligned the packages table with the
-- pricing shown on aibooking.dk at the time. The front page has since moved
-- on (src/utils/pricing.ts there is the source of truth) and this table
-- drifted: Starter still showed 200 included minutes and a setup_fee tied
-- to a since-removed "setup = one month's subscription" rule, instead of
-- the current flat, optional 999 kr setup fee shared by every package.
--
-- Now that Starter/Professional/Enterprise checkout goes through the exact
-- same Stripe Payment Links the front page uses (see
-- lib/billing/package-launch-offer.ts), what's charged is whatever those
-- links are configured for in Stripe regardless of what this table says —
-- but the dashboard still reads monthly_price/included_minutes/setup_fee
-- from here to describe each package before checkout, so it needs to match
-- what the customer is actually about to pay.
update public.packages
set monthly_price = 999.00, included_minutes = 150, setup_fee = 999.00
where package_name = 'Starter';

update public.packages
set monthly_price = 2499.00, included_minutes = 600, setup_fee = 999.00
where package_name = 'Professional';

update public.packages
set monthly_price = 5999.00, included_minutes = 2000, setup_fee = 999.00
where package_name = 'Enterprise';
