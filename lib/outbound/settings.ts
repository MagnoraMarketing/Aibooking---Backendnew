import type { outboundCampaignSettingsSchema } from "@/lib/security";
import type { z } from "zod";

// The campaign settings, translated between the form's shape and the
// database's. Kept in one place because three routes need the same mapping
// and a column missed in one of them is a setting that silently does nothing.
export type CampaignSettingsInput = z.infer<typeof outboundCampaignSettingsSchema>;

export function settingsToDbRow(settings: CampaignSettingsInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (settings.agentInstruction !== undefined) row.agent_instruction = settings.agentInstruction || null;
  if (settings.callWindowStart !== undefined) row.call_window_start = settings.callWindowStart;
  if (settings.callWindowEnd !== undefined) row.call_window_end = settings.callWindowEnd;
  if (settings.callDays !== undefined) row.call_days = settings.callDays;
  if (settings.callTimezone !== undefined) row.call_timezone = settings.callTimezone;
  if (settings.maxConcurrentCalls !== undefined) row.max_concurrent_calls = settings.maxConcurrentCalls;
  if (settings.maxAttempts !== undefined) row.max_attempts = settings.maxAttempts;
  if (settings.retryAfterMinutes !== undefined) row.retry_after_minutes = settings.retryAfterMinutes;
  if (settings.voicemailMessage !== undefined) row.voicemail_message = settings.voicemailMessage || null;
  return row;
}

// The window's two ends have to be checked together, and against each other:
// the database rejects start >= end with a constraint violation, which
// reaches the customer as "Something went wrong".
export function windowIssue(start: string | undefined, end: string | undefined): string | null {
  if (!start || !end) return null;
  return start < end ? null : "Ringetiderne skal starte før de slutter.";
}
