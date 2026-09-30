import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadCallDetail } from "@/lib/aibooking-dashboard/service";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One call with its transcript and recording, for the history's detail view.
// The recording is handed out as our own ./recording route: Vapi's link needs
// the private key since July 2026 and does not play in a browser.
export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const id = requireParam(params, "id");
  const call = await loadCallDetail(id);
  return NextResponse.json({
    call: {
      ...call,
      recordingUrl: call.recordingUrl || call.hasRecording ? `/api/admin/aibooking-dashboard/calls/${encodeURIComponent(id)}/recording` : null,
    },
  });
});
