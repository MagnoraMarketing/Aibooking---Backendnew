import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, doNotCallInputSchema } from "@/lib/security";
import { normalizePhone } from "@/lib/outbound/phone";
import { suppressNumber } from "@/lib/outbound/suppression";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// The customer's do-not-call list: numbers neither the manual dialer nor an
// AI campaign will ever ring (see lib/outbound/suppression.ts).
export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const { data, error } = await getAdminClient()
    .from("do_not_call_numbers")
    .select("id, phone_number, reason, created_at")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return NextResponse.json({ numbers: data ?? [] });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, doNotCallInputSchema);

  const phone = normalizePhone(body.phone, body.defaultCountry);
  if (!phone.ok) throw ApiError.badRequest("Telefonnummeret er ugyldigt.");

  await suppressNumber(customerId, phone.e164, body.reason ?? null);

  // Leads already holding this number stop being callable too.
  await getAdminClient()
    .from("leads")
    .update({ status: "do_not_call", next_call_at: null })
    .eq("customer_id", customerId)
    .eq("phone_number", phone.e164);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "do_not_call.added",
    entityType: "do_not_call_number",
    metadata: { phoneNumber: phone.e164 },
  });

  return NextResponse.json({ phoneNumber: phone.e164 }, { status: 201 });
});
