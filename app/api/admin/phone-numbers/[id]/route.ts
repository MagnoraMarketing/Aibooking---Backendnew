import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { releasePhoneNumber } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Master admin release — same underlying action as the customer-facing
// DELETE (app/api/customer/phone-numbers/[id]), for support to use when a
// customer can't or shouldn't do it themselves.
export const DELETE = withErrorHandling(async (_request, { params }) => {
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
  if (row.purchase_status === "released") throw ApiError.badRequest("Nummeret er allerede frigivet");

  await releasePhoneNumber(phoneNumberId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "phone_number.released_by_admin",
    entityType: "phone_number",
    entityId: phoneNumberId,
  });

  return NextResponse.json({ success: true });
});
