// How long a campaign waits before ringing a contact again, by what the
// last attempt came to. Only outcomes where nobody was reached are ever
// retried; the campaign's own retry_rules override the single
// retry_after_minutes it had before (0047_outbound_dialer_v2.sql).

export const RETRYABLE_OUTCOMES = ["no_answer", "busy", "voicemail", "failed"] as const;
export type RetryableOutcome = (typeof RETRYABLE_OUTCOMES)[number];
export type RetryRules = Partial<Record<RetryableOutcome, number>>;

// What a new campaign starts with: a busy line is worth another go soon, a
// voicemail box tomorrow.
export const DEFAULT_RETRY_RULES: Required<RetryRules> = {
  no_answer: 240,
  busy: 30,
  voicemail: 1440,
  failed: 60,
};

export function retryDelayMinutes(rules: unknown, outcome: string, fallbackMinutes: number): number {
  const value = rules && typeof rules === "object" ? (rules as Record<string, unknown>)[outcome] : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallbackMinutes;
}
