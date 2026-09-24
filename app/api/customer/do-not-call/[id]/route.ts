import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Takes a number off the do-not-call list. Leads that were marked
// do-not-call because of it stay marked — lifting the list entry makes the
// number callable again, but whether a particular lead should be rung is
// still a decision for whoever opens it.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const id = requireParam(params, "id");
  const supabase = getAdminClient();

  const { data: row, error } = await supabase
    .from("do_not_call_numbers")
    .select("id, customer_id, phone_number")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.customer_id !== customerId) throw ApiError.notFound("Number not found");

  const { error: deleteError } = await supabase.from("do_not_call_numbers").delete().eq("id", id).eq("customer_id", customerId);
  if (deleteError) throw deleteError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "do_not_call.removed",
    entityType: "do_not_call_number",
    entityId: id,
    metadata: { phoneNumber: row.phone_number },
  });

  return NextResponse.json({ deleted: true });
});
