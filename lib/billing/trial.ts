export const TRIAL_DAYS = 7;

// New customers get a small free trial — TRIAL_MINUTES of usable minutes
// (voice and widget draw from the same shared credit pool, see
// lib/credits/ledger.ts), good for TRIAL_DAYS — so they can set an agent up
// and try it live before deciding to subscribe. Either limit running out
// ends the trial: 7 days pass, or the 5 minutes are used, whichever comes
// first (see hasEmbedCodeAccess below).
export const TRIAL_MINUTES = 5;
export const TRIAL_SECONDS = TRIAL_MINUTES * 60;

export function isWithinTrial(customerCreatedAt: string): boolean {
  const createdAt = new Date(customerCreatedAt).getTime();
  return Date.now() - createdAt < TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

export function trialDaysRemaining(customerCreatedAt: string): number {
  const createdAt = new Date(customerCreatedAt).getTime();
  const remainingMs = TRIAL_DAYS * 24 * 60 * 60 * 1000 - (Date.now() - createdAt);
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

// A separate, longer trial granted the first time a customer connects their
// own Twilio number through the Inbound page's "Prøv gratis i 30 dage" flow
// (see app/api/customer/phone-numbers/route.ts) — a risk-free way to try a
// real inbound number via call forwarding before committing. Unlike the
// signup trial, this has no minute cap (see hasEmbedCodeAccess below) since
// the customer is bringing their own Twilio number/credits, not drawing
// down ours.
export const BYO_TRIAL_DAYS = 30;

export function isWithinByoTrial(byoTrialExpiresAt: string | null | undefined): boolean {
  if (!byoTrialExpiresAt) return false;
  return Date.now() < new Date(byoTrialExpiresAt).getTime();
}

export function byoTrialDaysRemaining(byoTrialExpiresAt: string | null | undefined): number {
  if (!byoTrialExpiresAt) return 0;
  const remainingMs = new Date(byoTrialExpiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

// Generating the embed code (the "go live on a real website" step) requires
// either a paid subscription in good standing, or still being inside the
// free trial window with trial minutes left. Building and testing an agent
// stays free indefinitely; only publishing it is gated. Once the trial
// window or its minutes run out, the only way back in is subscribing —
// a leftover balance from some other source (e.g. a manual credit) does
// NOT substitute for that on its own, unlike the trial-era version of this
// check.
export function hasEmbedCodeAccess(params: {
  customerCreatedAt: string;
  subscriptionStatus: string | null | undefined;
  balanceSeconds: number;
  byoTrialExpiresAt?: string | null;
}): boolean {
  if (params.subscriptionStatus && ACTIVE_SUBSCRIPTION_STATUSES.includes(params.subscriptionStatus)) {
    return true;
  }
  if (isWithinByoTrial(params.byoTrialExpiresAt)) {
    return true;
  }
  return isWithinTrial(params.customerCreatedAt) && params.balanceSeconds > 0;
}
