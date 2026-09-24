import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { isWithinCallWindow, parseWallClock } from "@/lib/outbound/call-window";
import { dialSingleContact } from "@/lib/outbound/dialer";
import { isSuppressed } from "@/lib/outbound/suppression";
import { outboundNumberIssue } from "@/lib/phone-numbers";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

const testCallSchema = z.object({ contactId: z.string().uuid().optional() });

// "Test med ét lead": places exactly one real call from a campaign that has
// not been launched yet (or is paused), so the customer hears the agent,
// the number and the lead variables working before a thousand people get
// the same call. Held to the same rules as the queue — minutes, the
// calling hours, the do-not-call list — because it is a real call to a real
// person. Billed like any other campaign call.
export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const campaignId = requireParam(params, "id");
  const body = await readJsonBody(request, testCallSchema);
  const supabase = getAdminClient();

  const { data: campaign, error } = await supabase.from("outbound_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== customerId) throw ApiError.notFound("Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "paused") {
    throw ApiError.badRequest("En testopkald kan kun laves, før kampagnen startes, eller mens den er på pause.");
  }

  if ((await checkAndRefillIfNeeded(customerId)).balanceSeconds <= 0) {
    throw ApiError.paymentRequired("Der er ikke flere AI-minutter på kontoen.");
  }

  const within = isWithinCallWindow(
    {
      startMinutes: parseWallClock(campaign.call_window_start),
      endMinutes: parseWallClock(campaign.call_window_end),
      days: campaign.call_days ?? [],
      timeZone: campaign.call_timezone,
    },
    new Date()
  );
  if (!within) throw ApiError.badRequest("Kampagnen er uden for sine ringetider lige nu.");

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("customer_id, phone_number, vapi_phone_number_id, twilio_sid, purchase_status, released_at")
    .eq("id", campaign.phone_number_id)
    .maybeSingle();
  if (!phoneNumber || phoneNumber.customer_id !== customerId) throw ApiError.badRequest("Phone number no longer exists");
  const numberIssue = outboundNumberIssue(phoneNumber, { usesVapi: !(await widgetDialsThroughTwilio(campaign.widget_id)) });
  if (numberIssue) throw ApiError.badRequest(numberIssue);

  let query = supabase
    .from("outbound_campaign_contacts")
    .select("id, phone_number, status")
    .eq("campaign_id", campaignId)
    .eq("status", "pending");
  query = body.contactId ? query.eq("id", body.contactId) : query.eq("attempts", 0).order("created_at", { ascending: true });
  const { data: contact } = await query.limit(1).maybeSingle();
  if (!contact) throw ApiError.badRequest("Der er ingen kontakt i kampagnen, der mangler at blive ringet op.");
  if (await isSuppressed(customerId, contact.phone_number)) {
    throw ApiError.badRequest("Nummeret står på spærrelisten og kan ikke ringes op.");
  }

  try {
    await dialSingleContact(campaignId, contact.id);
  } catch (err) {
    console.error("[outbound test call] refused:", err);
    throw ApiError.badRequest("Testopkaldet kunne ikke startes. Tjek agent og nummer, og prøv igen.");
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.test_call",
    entityType: "outbound_campaign",
    entityId: campaignId,
    metadata: { contactId: contact.id },
  });

  return NextResponse.json({ contactId: contact.id, phoneNumber: contact.phone_number });
});
