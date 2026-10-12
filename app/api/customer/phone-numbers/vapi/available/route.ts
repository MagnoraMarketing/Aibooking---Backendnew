import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";
import { listVapiPhoneNumbers } from "@/lib/vapi";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The numbers in the platform's Vapi account that no agent has claimed yet.
//
// Vapi hands out one number for free and wants a card for the rest, so a
// number already paid for and sitting idle is worth more than a new one. It
// is also the only way to attach a number bought directly in Vapi's own
// dashboard, which is where an admin buys in bulk.
//
// Claimed means claimed by ANY customer on this platform: the pool belongs to
// the platform, and offering one customer a number another is already
// answering calls on would hand them each other's callers.
export const GET = withErrorHandling(async () => {
  await requireCustomerAdmin();
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
