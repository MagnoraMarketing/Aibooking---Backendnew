import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { InboundManager } from "@/components/dashboard/inbound-manager";
import type { PhoneNumber, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export type PhoneNumberRow = PhoneNumber;

export default async function InboundPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: phoneNumbers }] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<Widget[]>(),
    supabase
      .from("phone_numbers")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<PhoneNumberRow[]>(),
  ]);

  return <InboundManager widgets={widgets ?? []} initialPhoneNumbers={phoneNumbers ?? []} />;
}
