import "server-only";
import { getAdminClient } from "@/lib/database/admin";

// The customer's do-not-call list (0047_outbound_dialer_v2.sql). Checked by
// everything that can ring someone — the manual dialer's TwiML route and the
// AI campaign queue — so a number on it is never called, whichever list or
// campaign it turns up in later.

export async function suppressedNumbers(customerId: string, phoneNumbers: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(phoneNumbers)];
  const supabase = getAdminClient();
  for (let i = 0; i < unique.length; i += 500) {
    const { data, error } = await supabase
      .from("do_not_call_numbers")
      .select("phone_number")
      .eq("customer_id", customerId)
      .in("phone_number", unique.slice(i, i + 500));
    if (error) throw error;
    for (const row of data ?? []) found.add(row.phone_number);
  }
  return found;
}

export async function isSuppressed(customerId: string, phoneNumber: string): Promise<boolean> {
  return (await suppressedNumbers(customerId, [phoneNumber])).has(phoneNumber);
}

export async function suppressNumber(customerId: string, phoneNumber: string, reason: string | null): Promise<void> {
  const { error } = await getAdminClient()
    .from("do_not_call_numbers")
    .upsert(
      { customer_id: customerId, phone_number: phoneNumber, reason },
      { onConflict: "customer_id,phone_number", ignoreDuplicates: true }
    );
  if (error) throw error;
}
