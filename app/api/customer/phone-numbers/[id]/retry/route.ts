import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { provisionPurchasedNumber } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Re-attempts provisioning for a number whose Twilio purchase or Vapi
// import failed after payment already succeeded (purchase_status='failed')
// — no new Stripe charge, just another try at the Twilio/Vapi side. See
// lib/phone-numbers/provisionPurchasedNumber for why a fresh call is safe
// even if the previous attempt partially succeeded.
export const POST = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const phoneNumberId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: row, error } = await supabase
    .from("phone_numbers")
    .select("id, customer_id, purchase_status")
    .eq("id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.customer_id !== customerId) throw ApiError.notFound("Phone number not found");
  if (row.purchase_status !== "failed") {
    throw ApiError.badRequest("Dette nummer er ikke i en fejlet tilstand");
  }

  await provisionPurchasedNumber(phoneNumberId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.provisioning_retried",
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
