-- Automatic follow-up mails during the free trial (lib/email/trial-followups.ts):
--
--   day1 — the day after signup: thanks for the interest, the step-by-step
--          guide in the dashboard, book a meeting if you have questions.
--   day6 — the day before the trial ends, only if the customer hasn't paid:
--          how has it gone, book an onboarding meeting.
--
-- trial_followups marks the customers these are for. Only self-signups set
-- it (lib/customers/self-signup.ts), so customers the master admin creates by
-- hand — and every customer that already exists when this ships — never get
-- them. The *_sent_at columns make each mail go out at most once, however
-- often the daily job runs.
alter table public.customers
  add column if not exists trial_followups boolean not null default false,
  add column if not exists followup_day1_sent_at timestamptz,
  add column if not exists followup_day6_sent_at timestamptz;

create index if not exists customers_trial_followups_idx
  on public.customers (created_at)
  where trial_followups;
