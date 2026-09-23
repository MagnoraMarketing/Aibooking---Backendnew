-- ---------------------------------------------------------------------------
-- Starter is 999 kr/month for 150 included minutes. 0042 already set this,
-- but the production table still read 200 (0018's value): the dashboard
-- showed "200 minutter inkluderet" and invoice.paid credited 200 minutes
-- per Starter payment (lib/billing/subscription-sync.ts grants
-- packages.included_minutes). Re-assert it on its own so it can be run by
-- itself; it is idempotent.
-- ---------------------------------------------------------------------------
update public.packages
set included_minutes = 150
where package_name = 'Starter';
