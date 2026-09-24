import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, leadDuplicateCheckSchema } from "@/lib/security";
import { suppressedNumbers } from "@/lib/outbound/suppression";

export const dynamic = "force-dynamic";

// The import preview's "already have this number" check. The browser finds
// duplicates inside the file itself; only the server knows what is already
// stored — in the target list, anywhere else for this customer, or on the
// do-not-call list.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, leadDuplicateCheckSchema);
  const supabase = getAdminClient();

  const inList = new Set<string>();
  const inTenant = new Set<string>();
  for (let i = 0; i < body.phones.length; i += 300) {
    const { data, error } = await supabase
      .from("leads")
      .select("list_id, phone_number")
      .eq("customer_id", customerId)
      .in("phone_number", body.phones.slice(i, i + 300));
    if (error) throw error;
    for (const row of data ?? []) {
      if (body.listId && row.list_id === body.listId) inList.add(row.phone_number);
      else inTenant.add(row.phone_number);
    }
  }

  const suppressed = await suppressedNumbers(customerId, body.phones);

  return NextResponse.json({
    inList: [...inList],
    inTenant: [...inTenant].filter((phone) => !inList.has(phone)),
    suppressed: [...suppressed],
  });
});
