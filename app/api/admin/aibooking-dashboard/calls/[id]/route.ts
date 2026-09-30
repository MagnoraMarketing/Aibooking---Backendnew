import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadCallDetail } from "@/lib/aibooking-dashboard/service";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One call with its transcript and recording, for the history's detail view.
export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const call = await loadCallDetail(requireParam(params, "id"));
  return NextResponse.json({ call });
});
