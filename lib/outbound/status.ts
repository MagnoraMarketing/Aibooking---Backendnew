// A campaign's life, in one place.
//
// Two states were enough while launching placed every call in a single
// request: before, and after. With a queue the campaign has a life — it runs,
// it can be paused mid-queue, and it ends either having reached everyone or
// having failed to reach anyone. Four files need to agree on what each state
// permits, and they drift the moment each decides for itself.

export const CAMPAIGN_STATUSES = ["draft", "running", "paused", "completed", "failed"] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// Only a running campaign is dialled. A paused one keeps its queue exactly as
// it is — that is the difference between pausing and cancelling.
export function isDialable(status: CampaignStatus): boolean {
  return status === "running";
}

// What the buttons offer. Launching is for a draft; pause and resume move a
// campaign between running and paused; a finished campaign offers neither.
export function canLaunch(status: CampaignStatus): boolean {
  return status === "draft";
}

export function canPause(status: CampaignStatus): boolean {
  return status === "running";
}

export function canResume(status: CampaignStatus): boolean {
  return status === "paused";
}

// What a campaign may still be changed to say.
//
// Name, purpose, hours and the rest stay editable for as long as there is a
// call left to place — changing "ring og mind om tiden i morgen" halfway
// through a list is a legitimate thing to want, and it only affects calls not
// yet made. A finished campaign is a record of what happened.
export function canEditSettings(status: CampaignStatus): boolean {
  return status === "draft" || status === "paused" || status === "running";
}

// Which agent and which number, on the other hand, decide what a call IS.
// Changing them under a running campaign would make one list half answered by
// one agent from one number and half by another, with nothing in the record
// saying which was which.
export function canChangeAgentOrNumber(status: CampaignStatus): boolean {
  return status === "draft" || status === "paused";
}

// Replacing the contact list throws away rows. That is only safe while none
// of them has been dialled: a contact with a call behind it carries its
// result, its recording and its transcript, and those are not ours to delete
// because someone edited a textarea.
export function canReplaceAllContacts(status: CampaignStatus): boolean {
  return status === "draft";
}
