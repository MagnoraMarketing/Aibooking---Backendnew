import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, requireParam, leadUpdateSchema } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Records a call's outcome after the agent hangs up — the disposition form
// shown right after a call ends in the dialer UI PATCHes here. Also the
// backstop-updated route from dialer-status if the browser side never
// checks in (tab closed mid-call), so this is deliberately a partial
// update, not a replace.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const listId = requireParam(params, "id");
  const leadId = requireParam(params, "leadId");
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, leadUpdateSchema);

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, customer_id, list_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead || lead.customer_id !== customerId || lead.list_id !== listId) {
    throw ApiError.notFound("Lead not found");
  }

  const update: Record<string, unknown> = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.disposition !== undefined) update.disposition = body.disposition;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.callSid !== undefined) update.call_sid = body.callSid;

  const { data: updated, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;

  return NextResponse.json({ lead: updated });
});
