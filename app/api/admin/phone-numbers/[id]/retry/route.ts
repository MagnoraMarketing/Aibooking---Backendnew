import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { provisionPurchasedNumber } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Master admin retry — same underlying action as the customer-facing POST
// (app/api/customer/phone-numbers/[id]/retry), for support to use.
export const POST = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();
  const phoneNumberId = requireParam(params, "id");

  const { data: row, error } = await supabase
    .from("phone_numbers")
    .select("id, purchase_status")
    .eq("id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw ApiError.notFound("Phone number not found");
  if (row.purchase_status !== "failed") {
    throw ApiError.badRequest("Dette nummer er ikke i en fejlet tilstand");
  }

  await provisionPurchasedNumber(phoneNumberId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "phone_number.provisioning_retried_by_admin",
    entityType: "phone_number",
    entityId: phoneNumberId,
  });

  const { data: updated, error: refetchError } = await supabase
    .from("phone_numbers")
    .select("*")
    .eq("id", phoneNumberId)
    .single();
  if (refetchError) throw refetchError;

  return NextResponse.json({ phoneNumber: updated });
});
