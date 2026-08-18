import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { releasePhoneNumber } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Releases a number back to Twilio — irreversible on Twilio's side, which
// is why the dashboard requires an explicit confirmation before calling
// this (see components/dashboard/inbound-manager.tsx). The row itself is
// kept with purchase_status='released', not deleted (see lib/phone-numbers/
// releasePhoneNumber for why).
export const DELETE = withErrorHandling(async (_request, { params }) => {
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
  if (row.purchase_status === "released") throw ApiError.badRequest("Nummeret er allerede frigivet");

  await releasePhoneNumber(phoneNumberId);

  return NextResponse.json({ success: true });
});
