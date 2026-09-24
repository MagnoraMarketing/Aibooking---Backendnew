// Vapi's reasons for a call that never became a conversation (the same test
// the webhook uses to decide whether a campaign contact is retried).
const NO_ANSWER_REASONS = /no-answer|busy|voicemail|customer-did-not-answer|failed|rejected|declined|unreachable/i;

// What a campaign call came to, for the contact list and the campaign's
// numbers. The provider's endedReason says whether anyone picked up; when
// the agent's analysis reports a verdict of its own (structuredData.outcome,
// set up per assistant in Vapi), that is the better answer for a call that
// was answered.
const AI_OUTCOMES = [
  "interested",
  "meeting_booked",
  "callback",
  "not_interested",
  "wrong_number",
  "do_not_call",
  "other",
] as const;

export function campaignCallOutcome(endedReason: unknown, analysis: unknown): string {
  const reason = typeof endedReason === "string" ? endedReason : "";
  if (/voicemail/i.test(reason)) return "voicemail";
  if (/busy/i.test(reason)) return "busy";
  if (/no-answer|did-not-answer/i.test(reason)) return "no_answer";
  if (NO_ANSWER_REASONS.test(reason)) return "failed";

  const structured = (analysis as { structuredData?: { outcome?: unknown } } | null)?.structuredData;
  const verdict = typeof structured?.outcome === "string" ? structured.outcome.toLowerCase() : null;
  return verdict && (AI_OUTCOMES as readonly string[]).includes(verdict) ? verdict : "answered";
}

