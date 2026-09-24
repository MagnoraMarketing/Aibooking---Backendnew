import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, requireParam, leadUpdateSchema, writeAuditLog } from "@/lib/security";
import { suppressNumber } from "@/lib/outbound/suppression";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

async function loadOwnLead(customerId: string, listId: string, leadId: string) {
  const { data: lead, error } = await getAdminClient().from("leads").select("*").eq("id", leadId).maybeSingle();
  if (error) throw error;
  if (!lead || lead.customer_id !== customerId || lead.list_id !== listId) {
    throw ApiError.notFound("Lead not found");
  }
  return lead;
}

// A lead with its call history — every manual call placed to it, newest
// first, with outcome, duration and whether a recording exists.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const lead = await loadOwnLead(customerId, requireParam(params, "id"), requireParam(params, "leadId"));

  const { data: calls, error } = await getAdminClient()
    .from("dialer_calls")
    .select(
      "id, from_number, to_number, status, duration_seconds, recording_sid, recording_status, outcome, notes, started_at, answered_at, ended_at"
    )
    .eq("customer_id", customerId)
    .eq("lead_id", lead.id)
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return NextResponse.json({
    lead,
    // The sid itself stays server-side; the page only needs to know there is
    // something to play (see the recording route).
    calls: (calls ?? []).map(({ recording_sid, ...call }) => ({
      ...call,
      has_recording: Boolean(recording_sid) && call.recording_status === "completed",
    })),
  });
});

// Records a call's outcome after the agent hangs up, schedules a callback,
// marks do-not-call, or edits/moves the lead. Deliberately a partial update.
//
// The lead's status follows from the outcome here rather than from the
// browser: "call_back" makes it a callback due at callbackAt, "do_not_call"
// takes it (and its number, customer-wide) out of every queue for good.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const listId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, leadUpdateSchema);
  const lead = await loadOwnLead(customerId, listId, requireParam(params, "leadId"));

  const update: Record<string, unknown> = {};
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.callSid !== undefined) update.call_sid = body.callSid;
  if (body.contactName !== undefined) update.contact_name = body.contactName || null;
  if (body.company !== undefined) update.company = body.company || null;
  if (body.email !== undefined) update.email = body.email || null;
  if (body.phoneNumber !== undefined) update.phone_number = body.phoneNumber;
  if (body.customData !== undefined) update.custom_data = body.customData;

  if (body.listId !== undefined && body.listId !== listId) {
    const { data: target } = await supabase
      .from("lead_lists")
      .select("id, customer_id")
      .eq("id", body.listId)
      .maybeSingle();
    if (!target || target.customer_id !== customerId) throw ApiError.badRequest("Listen findes ikke.");
    update.list_id = body.listId;
  }

  if (body.disposition !== undefined) {
    update.disposition = body.disposition;
    if (body.disposition === "do_not_call") {
      update.status = "do_not_call";
      update.next_call_at = null;
    } else if (body.disposition === "call_back") {
      if (!body.callbackAt) throw ApiError.badRequest("Vælg hvornår der skal ringes tilbage.");
      update.status = "callback";
      update.next_call_at = body.callbackAt;
    } else {
      update.status = "called";
      update.next_call_at = null;
    }
  } else if (body.callbackAt !== undefined) {
    // "Planlæg tilbagekald" without a call first.
    update.status = body.callbackAt ? "callback" : "pending";
    update.next_call_at = body.callbackAt;
  }
  // An explicit status from an older client, never allowed to lift a
  // do-not-call — that is only undone by removing the number from the list.
  if (body.status !== undefined && update.status === undefined && lead.status !== "do_not_call") {
    update.status = body.status;
  }

  const { data: updated, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", lead.id)
    .eq("customer_id", customerId)
    .select("*")
    .single();
  if (error) throw error;

  if (update.status === "do_not_call") {
    await suppressNumber(customerId, updated.phone_number, body.notes ?? "Markeret i dialeren");
    await writeAuditLog({
      actorId: ctx.userId,
      actorRole: ctx.profile.role,
      customerId,
      action: "lead.do_not_call",
      entityType: "lead",
      entityId: lead.id,
      metadata: { phoneNumber: updated.phone_number },
    });
  }

  // The outcome belongs to the call too, so the history shows what each
  // call came to — not just the lead's latest state.
  if (body.callSid && (body.disposition !== undefined || body.notes !== undefined)) {
    const callUpdate: Record<string, unknown> = {};
    if (body.disposition !== undefined) callUpdate.outcome = body.disposition;
    if (body.notes !== undefined) callUpdate.notes = body.notes;
    await supabase
      .from("dialer_calls")
      .update(callUpdate)
      .eq("twilio_call_sid", body.callSid)
      .eq("customer_id", customerId);
  }

  return NextResponse.json({ lead: updated });
});
