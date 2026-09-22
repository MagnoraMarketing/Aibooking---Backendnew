import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";
import { listVapiPhoneNumbers } from "@/lib/vapi";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Admin-wide equivalent of /api/customer/phone-numbers/vapi/available — the
// numbers in the platform's Vapi account no phone_numbers row has claimed
// yet, for the "Tilknyt telefonnummer" picker on the widget/inbound create
// and edit forms (spec sections 6 and 7).
export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data: claimed, error } = await supabase
    .from("phone_numbers")
    .select("vapi_phone_number_id")
    .not("vapi_phone_number_id", "is", null)
    .is("released_at", null);
  if (error) throw error;

  const taken = new Set((claimed ?? []).map((row) => row.vapi_phone_number_id as string));
  const numbers = (await listVapiPhoneNumbers()).filter((number) => !taken.has(number.id));

  return NextResponse.json({ numbers });
});
