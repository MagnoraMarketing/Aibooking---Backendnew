-- Campaign settings, and the queue they need to mean anything.
--
-- A campaign used to be a name, an agent, a number and a list, and launching
-- it fired every contact at once in a single request. That is three problems
-- at once: Vapi allows ten concurrent calls, so a hundred-contact campaign
-- mostly failed; a contact who did not pick up was never tried again; and a
-- campaign launched at 21:00 rang a hundred people at 21:00.
--
-- Settings alone cannot fix any of that. Dialling has to happen over time
-- instead of in one burst, so the contact list becomes a queue the dialer
-- works through (see app/api/internal/outbound-dialer).

alter table outbound_campaigns
  -- What this campaign is for, in the customer's words: "ring og mind om
  -- tiden i morgen". Appended to the agent's own prompt for these calls only,
  -- which is what makes two campaigns on the same agent different.
  add column if not exists agent_instruction text,
  -- When it is acceptable to ring someone. Stored as local wall-clock time
  -- plus the zone it is meant in — a window is "09:00 in Denmark", not an
  -- instant, and it has to survive daylight saving.
  add column if not exists call_window_start time not null default '09:00',
  add column if not exists call_window_end time not null default '17:00',
  -- ISO weekdays, Monday = 1. Weekdays only by default.
  add column if not exists call_days smallint[] not null default '{1,2,3,4,5}',
  add column if not exists call_timezone text not null default 'Europe/Copenhagen',
  -- Vapi's own ceiling is ten concurrent calls for the whole account, shared
  -- by every customer on this platform, so a per-campaign default well under
  -- it leaves room for everyone else.
  add column if not exists max_concurrent_calls smallint not null default 3,
  -- One attempt is what the platform did before this; anything more is the
  -- customer choosing to chase.
  add column if not exists max_attempts smallint not null default 1,
  add column if not exists retry_after_minutes smallint not null default 60;

alter table outbound_campaigns
  add constraint outbound_campaigns_window_check
    check (call_window_start < call_window_end),
  add constraint outbound_campaigns_concurrency_check
    check (max_concurrent_calls between 1 and 10),
  add constraint outbound_campaigns_attempts_check
    check (max_attempts between 1 and 5),
  add constraint outbound_campaigns_retry_check
    check (retry_after_minutes between 5 and 1440);

alter table outbound_campaign_contacts
  add column if not exists attempts smallint not null default 0,
  -- When this contact is next due. Set at launch, pushed forward on a
  -- no-answer, and null once the contact is done either way.
  add column if not exists next_attempt_at timestamptz,
  -- When the current attempt started dialling, so an attempt that never
  -- reports back can be told from one still ringing.
  add column if not exists calling_since timestamptz;

-- The dialer's one read: everything due, oldest first.
create index if not exists outbound_campaign_contacts_due_idx
  on outbound_campaign_contacts (next_attempt_at)
  where status = 'pending' and next_attempt_at is not null;
