import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import type { Widget } from "@/types/database";
import { ApiError } from "@/types/errors";

const DEFAULT_TRIAL_SECONDS = 300; // 5 minutes

export interface TrialStatus {
  isTrialEligible: boolean;
  trialSecondsUsed: number;
  trialSecondsRemaining: number;
  trialExhausted: boolean;
}

export async function getTrialStatus(widgetId: string): Promise<TrialStatus> {
  const supabase = getAdminClient();

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("free_trial_seconds")
    .eq("id", widgetId)
    .maybeSingle();

  if (widgetError) throw widgetError;
  if (!widget) {
    throw ApiError.notFound("Widget not found");
  }

  // Sum all trial usage for this widget
  const { data: usageSessions, error: usageError } = await supabase
    .from("usage_sessions")
    .select("billed_duration_seconds")
    .eq("widget_id", widgetId)
    .eq("is_trial_usage", true);

  if (usageError) throw usageError;

  const trialSecondsUsed = usageSessions?.reduce((sum, session) => sum + (session.billed_duration_seconds || 0), 0) || 0;
  const trialSecondsAvailable = widget.free_trial_seconds || DEFAULT_TRIAL_SECONDS;
  const trialSecondsRemaining = Math.max(0, trialSecondsAvailable - trialSecondsUsed);

  return {
    isTrialEligible: trialSecondsRemaining > 0,
    trialSecondsUsed,
    trialSecondsRemaining,
    trialExhausted: trialSecondsRemaining <= 0,
  };
}

export async function enforceTrialLimit(widgetId: string): Promise<boolean> {
  const status = await getTrialStatus(widgetId);
  if (status.trialExhausted) {
    throw ApiError.paymentRequired(
      "Gratis prøveperiode på 5 minutter er udløbet. Opgrader til fuld adgang for at fortsætte med at bruge stemmeagenten."
    );
  }
  return true;
}

export async function markUsageAsTrialIfEligible(
  usageSessionId: string,
  widgetId: string
): Promise<boolean> {
  const status = await getTrialStatus(widgetId);
  if (!status.isTrialEligible) return false;

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("usage_sessions")
    .update({ is_trial_usage: true })
    .eq("id", usageSessionId);

  if (error) throw error;
  return true;
}
