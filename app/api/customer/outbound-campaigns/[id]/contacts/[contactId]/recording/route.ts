import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadStoredCallReport } from "@/lib/vapi/stored-call-report";
import { recordingResponse } from "@/lib/vapi/recording";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The recording of one outbound campaign call, streamed through us
// (?download=1 to save it). Same ownership check as ../route.ts.
export const GET = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");
  const contactId = requireParam(params, "contactId");

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .select("customer_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Campaign not found");

  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select("campaign_id, vapi_call_id, last_called_at")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact || contact.campaign_id !== campaignId || !contact.vapi_call_id) {
    throw ApiError.notFound("Der er ingen optagelse af denne samtale.");
  }

  const report = await loadStoredCallReport(supabase, contact.vapi_call_id);
  return recordingResponse(request, {
    callId: contact.vapi_call_id,
    startedAt: report?.startedAt ?? contact.last_called_at,
    fallbackUrl: report?.recordingUrl ?? null,
    download: new URL(request.url).searchParams.has("download"),
  });
});
