import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadStoredCallReport } from "@/lib/vapi/stored-call-report";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One outbound call, in the same detail Inbound shows.
//
// Answers in the shape the details modal already reads
// (app/api/customer/conversations/[id]/messages), so the same component
// renders both: transcript, summary and recording come from the call's
// end-of-call-report either way. `messages` is always empty — a phone call
// has no rows in conversation_messages, because nothing on our side is on
// the line to write them.
//
// `call` is the part Inbound gets from its conversation row and an outbound
// contact has nowhere else: who was rung, when, for how long, and how it
// ended. Nothing from the Vapi payload is passed through wholesale — the
// fields are named one by one, so no secret can ride along in it.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");
  const contactId = requireParam(params, "contactId");

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .select("id, customer_id, widget_id, name")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Campaign not found");

  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select("id, campaign_id, phone_number, contact_name, company, status, attempts, last_called_at, failure_reason, vapi_call_id")
    .eq("id", contactId)
    .maybeSingle();
  // Belonging to this campaign is the check that matters — the campaign is
  // already known to be this customer's.
  if (!contact || contact.campaign_id !== campaignId) throw ApiError.notFound("Contact not found");

  const [{ data: widget }, { data: phoneCall }, report] = await Promise.all([
    supabase.from("widgets").select("name").eq("id", campaign.widget_id).maybeSingle(),
    supabase
      .from("phone_calls")
      .select("duration_seconds, ended_reason, created_at")
      .eq("campaign_contact_id", contactId)
      .maybeSingle(),
    loadStoredCallReport(supabase, contact.vapi_call_id),
  ]);

  return NextResponse.json({
    widgetName: widget?.name ?? null,
    messages: [],
    transcript: report?.transcript ?? [],
    recordingUrl: report?.recordingUrl ?? null,
    summary: report?.summary ?? null,
    call: {
      contactName: contact.contact_name,
      company: contact.company,
      phoneNumber: contact.phone_number,
      status: contact.status,
      attempts: contact.attempts,
      // When we dialled is known even when no report ever arrived; the
      // report's own timestamp is closer to when the person picked up.
      startedAt: report?.startedAt ?? contact.last_called_at,
      durationSeconds: phoneCall?.duration_seconds ?? 0,
      endedReason: phoneCall?.ended_reason ?? report?.endedReason ?? null,
      failureReason: contact.failure_reason,
      // Vapi's own id for the call. An identifier, not a credential — it is
      // what support needs to look the call up, and the only Vapi detail
      // that leaves the server.
      vapiCallId: contact.vapi_call_id,
    },
  });
});
