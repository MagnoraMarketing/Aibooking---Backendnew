-- A campaign's life, beyond "draft" and "launched".
--
-- Two states were enough while launching meant placing every call in one
-- request: before, and after. With a queue the campaign has a life — it runs,
-- it can be paused mid-queue, and it ends either having called everyone or
-- having failed to. The dashboard could not tell any of that apart, and there
-- was no way to stop a campaign once it started short of deleting it.
--
-- 'launched' becomes 'running', because that is what it meant.

alter table outbound_campaigns
  drop constraint if exists outbound_campaigns_status_check;

update outbound_campaigns set status = 'running' where status = 'launched';

alter table outbound_campaigns
  add constraint outbound_campaigns_status_check
    check (status in ('draft', 'running', 'paused', 'completed', 'failed'));

alter table outbound_campaigns
  -- When the queue emptied. Set by the dialer, so "completed" is a fact about
  -- the contacts rather than a button someone pressed.
  add column if not exists finished_at timestamptz,
  -- Set while paused so the dashboard can say since when, and so resuming
  -- can tell a pause from a campaign that never started.
  add column if not exists paused_at timestamptz;

-- Who was called, beyond a number and a name. Optional: it comes from a third
-- column in the pasted list, and most lists will not have one.
alter table outbound_campaign_contacts
  add column if not exists company text,
  -- When the contact was last dialled. phone_calls has the authoritative
  -- record of what happened; this is what the contact list sorts and shows
  -- without joining every row to it.
  add column if not exists last_called_at timestamptz;

-- The overview counts contacts per campaign by status on every page load.
create index if not exists outbound_campaign_contacts_campaign_status_idx
  on outbound_campaign_contacts (campaign_id, status);

-- A contact's call details are looked up by the call it produced.
create index if not exists phone_calls_campaign_contact_idx
  on phone_calls (campaign_contact_id)
  where campaign_contact_id is not null;
