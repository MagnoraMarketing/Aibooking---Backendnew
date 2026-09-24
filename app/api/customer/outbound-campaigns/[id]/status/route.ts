import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, requireParam, campaignStatusActionSchema } from "@/lib/security";
import { canPause, canResume, canStop, type CampaignStatus } from "@/lib/outbound/status";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Stopping and restarting a campaign mid-queue.
//
// Pausing is not cancelling and not deleting: the queue stays exactly as it
// is, every contact keeps its place, and resuming picks up at the next one.
// The dialer simply stops looking at the campaign (lib/outbound/dialer.ts
// selects status='running'), so nothing has to be unwound.
//
// A call already ringing is left alone. It is a real conversation with a real
// person on the line, and the only way to "pause" it would be to hang up on
// them; its result is recorded as usual when it ends.
export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, campaignStatusActionSchema);
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .select("id, customer_id, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== customerId) throw ApiError.notFound("Campaign not found");

  const status = campaign.status as CampaignStatus;

  if (body.action === "stop") {
    if (!canStop(status)) throw ApiError.badRequest("Kampagnen kører ikke, så der er ikke noget at stoppe.");
    const now = new Date().toISOString();
    const { data: stopped, error: stopError } = await supabase
      .from("outbound_campaigns")
      .update({ status: "cancelled", finished_at: now, paused_at: null })
      .eq("id", campaignId)
      .in("status", ["running", "paused"])
      .select("*, outbound_campaign_contacts(count)")
      .maybeSingle();
    if (stopError) throw stopError;
    if (!stopped) throw ApiError.badRequest("Kampagnens status nåede at ændre sig. Genindlæs siden.");
    // Nothing still waiting is due any more.
    await supabase
      .from("outbound_campaign_contacts")
      .update({ next_attempt_at: null })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    await writeAuditLog({
      actorId: ctx.userId,
      actorRole: ctx.profile.role,
      customerId,
      action: "outbound_campaign.stopped",
      entityType: "outbound_campaign",
      entityId: campaignId,
    });
    return NextResponse.json({ campaign: stopped });
  }

  const pausing = body.action === "pause";

  if (pausing && !canPause(status)) {
    throw ApiError.badRequest("Kampagnen kører ikke, så der er ikke noget at sætte på pause.");
  }
  if (!pausing && !canResume(status)) {
    throw ApiError.badRequest("Kampagnen er ikke på pause.");
  }
  // The dialer pauses a campaign that runs out of minutes; resuming it
  // without any would only pause it again on the next tick.
  if (!pausing && (await checkAndRefillIfNeeded(customerId)).balanceSeconds <= 0) {
    throw ApiError.paymentRequired("Der er ikke flere AI-minutter på kontoen. Køb flere minutter for at genoptage kampagnen.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("outbound_campaigns")
    .update(
      pausing
        ? { status: "paused", paused_at: new Date().toISOString() }
        : { status: "running", paused_at: null }
    )
    .eq("id", campaignId)
    // Guards against two clicks racing: the second finds the status already
    // moved and changes nothing.
    .eq("status", pausing ? "running" : "paused")
    .select("*, outbound_campaign_contacts(count)")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw ApiError.badRequest("Kampagnens status nåede at ændre sig. Genindlæs siden.");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: pausing ? "outbound_campaign.paused" : "outbound_campaign.resumed",
    entityType: "outbound_campaign",
    entityId: campaignId,
  });

  return NextResponse.json({ campaign: updated });
});
