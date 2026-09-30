import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadCallDetail } from "@/lib/aibooking-dashboard/service";
import { recordingResponse } from "@/lib/vapi/recording";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The recording of one of the platform's own calls, streamed (?download=1
// to save it as a file). loadCallDetail refuses a call that is not one of
// the dashboard's agents'.
export const GET = withErrorHandling(async (request, { params }) => {
  await requireMasterAdmin();
  const call = await loadCallDetail(requireParam(params, "id"));
  return recordingResponse(request, {
    callId: call.id,
    startedAt: call.startedAt,
    fallbackUrl: call.recordingUrl,
    download: new URL(request.url).searchParams.has("download"),
  });
});
