import { NextResponse } from "next/server";
import { withErrorHandling, requireDialerSecret } from "@/lib/security";
import { runDialerTick, finishCompletedCampaigns } from "@/lib/outbound/dialer";
import { getAdminClient } from "@/lib/database/admin";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One tick can place several calls, each a round-trip to a telephony
// provider — well past the platform's 10s default.
export const maxDuration = 60;

// Works every launched campaign's queue a few contacts at a time.
//
// Called once a minute from the database (see
// 0040_outbound_dialer_schedule.sql). Not a Vercel Cron: this project is on a
// plan whose crons only run daily, and a dialer that wakes once a day is not
// a dialer. pg_cron plus pg_net is already sitting in Postgres, costs
// nothing, and keeps the schedule next to the queue it drives.
//
// Guarded by its own secret (OUTBOUND_DIALER_SECRET), not the relay's: they
// are different callers, and this one places calls that cost real money, so
// it must never be reachable by an arbitrary caller.
export const POST = withErrorHandling(async (request) => {
  requireDialerSecret(request);

  const result = await runDialerTick();
  // After dialling, not before: a campaign whose last contact was just
  // claimed is not finished, and one whose last call the webhook settled a
  // minute ago is.
  const finished = await finishCompletedCampaigns(getAdminClient());

  // Logged, not silent: a tick that defers everything looks identical to one
  // that did nothing, and the difference is the whole question when a
  // customer asks why their campaign has not started.
  if (result.campaigns > 0 || finished > 0) {
    console.log(
      `Outbound dialer: ${result.campaigns} campaign(s), ${result.dialed} dialed, ${result.deferred} deferred, ${result.failed} failed, ${finished} finished`
    );
  }

  return NextResponse.json({ ...result, finished });
});
