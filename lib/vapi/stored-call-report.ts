import "server-only";
import type { getAdminClient } from "@/lib/database/admin";
import { parseCallReport, type VapiCallReport } from "./call-report";

// The end-of-call-report for a call we have already seen.
//
// Every Vapi delivery is stored verbatim in vapi_events by
// app/api/webhooks/vapi, so what was said, what it came to and the audio are
// all already here — this is the reading of it. Inbound asks for it by the
// conversation's call id, outbound by the campaign contact's; the lookup is
// the same, so it lives in one place rather than being written twice with
// two chances to drift.
export async function loadStoredCallReport(
  supabase: ReturnType<typeof getAdminClient>,
  vapiCallId: string | null | undefined
): Promise<VapiCallReport | null> {
  if (!vapiCallId) return null;

  const { data: event } = await supabase
    .from("vapi_events")
    .select("payload")
    .eq("call_id", vapiCallId)
    .eq("type", "end-of-call-report")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return parseCallReport(event?.payload as Record<string, unknown> | null);
}
