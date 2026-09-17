import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { campaignStatsFor, EMPTY_STATS } from "@/lib/outbound/stats";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Who was called, and what came of it.
//
// A campaign used to show one number: how many contacts it had. Whether a
// call happened, who it reached, when, for how long and how it ended was in
// the database the whole time and nowhere on the screen — so a finished
// campaign said "sendt" and nothing else. This is the list behind a
// campaign, one row per person, with the call that was placed to them.
//
// Polled while a campaign runs, so it is two queries: the contacts, then the
// calls for those contacts. The call row is the billing record written by
// the Vapi webhook — the same one Inbound is billed from — not a second copy
// of the outcome kept here.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Campaign not found");

  const { data: contacts } = await supabase
    .from("outbound_campaign_contacts")
    .select(
      "id, phone_number, contact_name, company, status, attempts, last_called_at, next_attempt_at, failure_reason, vapi_call_id, created_at"
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  const contactIds = (contacts ?? []).map((contact) => contact.id);
  const calls = new Map<string, { durationSeconds: number; endedReason: string | null; at: string }>();

  if (contactIds.length > 0) {
    const { data: callRows } = await supabase
      .from("phone_calls")
      .select("campaign_contact_id, duration_seconds, ended_reason, created_at")
      .in("campaign_contact_id", contactIds);

    for (const call of callRows ?? []) {
      if (!call.campaign_contact_id) continue;
      calls.set(call.campaign_contact_id, {
        durationSeconds: call.duration_seconds ?? 0,
        endedReason: call.ended_reason,
        at: call.created_at,
      });
    }
  }

  const stats = await campaignStatsFor([campaignId], supabase);

  return NextResponse.json({
    campaign,
    stats: stats[campaignId] ?? EMPTY_STATS,
    contacts: (contacts ?? []).map((contact) => ({
      id: contact.id,
      phoneNumber: contact.phone_number,
      name: contact.contact_name,
      company: contact.company,
      status: contact.status,
      attempts: contact.attempts,
      lastCalledAt: contact.last_called_at,
      nextAttemptAt: contact.next_attempt_at,
      failureReason: contact.failure_reason,
      // Whether there is a call to open details for. The call id itself is
      // Vapi's, not a credential, but nothing about it is needed out here.
      hasCall: Boolean(contact.vapi_call_id),
      call: calls.get(contact.id) ?? null,
    })),
  });
});
