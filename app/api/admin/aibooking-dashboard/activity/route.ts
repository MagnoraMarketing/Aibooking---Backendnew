import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling } from "@/lib/security";
import { listDashboardAgents, loadActivity } from "@/lib/aibooking-dashboard/service";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [1, 7, 30, 90];

// Every call the dashboard's active agents made in the period, read live
// from Vapi. Transcripts and recordings are left out here and fetched per
// call (../calls/[id]) — the list only needs what the history and the
// statistics show.
export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30;

  const agents = await listDashboardAgents();
  const { calls, errors } = await loadActivity(
    agents.filter((agent) => agent.is_active),
    days
  );

  return NextResponse.json({ agents, calls, errors, days, fetchedAt: new Date().toISOString() });
});
