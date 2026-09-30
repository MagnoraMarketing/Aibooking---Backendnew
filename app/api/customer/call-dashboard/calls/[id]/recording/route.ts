import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadCallDetail } from "@/lib/aibooking-dashboard/service";
import { listCustomerAgents } from "@/lib/aibooking-dashboard/customer";
import { recordingResponse } from "@/lib/vapi/recording";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The recording of one of the customer's calls, streamed through us
// (?download=1 to save it). The call must be on one of their own agents.
export const GET = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const agents = await listCustomerAgents(ctx.profile.customer_id!);
  const call = await loadCallDetail(requireParam(params, "id"), agents);
  return recordingResponse(request, {
    callId: call.id,
    startedAt: call.startedAt,
    fallbackUrl: call.recordingUrl,
    download: new URL(request.url).searchParams.has("download"),
  });
});
