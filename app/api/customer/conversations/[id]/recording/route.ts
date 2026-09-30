import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadStoredCallReport } from "@/lib/vapi/stored-call-report";
import { recordingResponse } from "@/lib/vapi/recording";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The recording of one of the customer's conversations, streamed through us
// (?download=1 to save it) — Vapi's own link needs the private key.
export const GET = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("customer_id, vapi_call_id, started_at")
    .eq("id", requireParam(params, "id"))
    .maybeSingle();
  if (error) throw error;
  if (!conversation || conversation.customer_id !== ctx.profile.customer_id || !conversation.vapi_call_id) {
    throw ApiError.notFound("Der er ingen optagelse af denne samtale.");
  }

  const report = await loadStoredCallReport(supabase, conversation.vapi_call_id);
  return recordingResponse(request, {
    callId: conversation.vapi_call_id,
    startedAt: conversation.started_at,
    fallbackUrl: report?.recordingUrl ?? null,
    download: new URL(request.url).searchParams.has("download"),
  });
});
