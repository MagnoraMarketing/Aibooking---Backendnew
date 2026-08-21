import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { DialerManager } from "@/components/dashboard/dialer-manager";
import { PHONE_NUMBER_CLIENT_COLUMNS } from "@/lib/phone-numbers";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";

export const dynamic = "force-dynamic";

export interface LeadListRow {
  id: string;
  name: string;
  created_at: string;
  leads: { count: number }[];
}

export default async function DialerPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: phoneNumbers }, { data: lists }] = await Promise.all([
    // Only numbers bought through the platform can be used here — the
    // dialer places calls under the customer's own Twilio subaccount (see
    // lib/twilio/dialer.ts), which a BYO-Twilio number's caller ID
    // wouldn't be valid under. Same simplification the outbound campaigns
    // launch route already makes for Twilio-direct calls.
    supabase
      .from("phone_numbers")
      .select(PHONE_NUMBER_CLIENT_COLUMNS)
      .eq("customer_id", customerId)
      .eq("source", "platform_twilio")
      .eq("purchase_status", "active")
      .neq("direction", "inbound")
      .order("created_at", { ascending: false })
      .returns<PhoneNumberRow[]>(),
    supabase
      .from("lead_lists")
      .select("*, leads(count)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<LeadListRow[]>(),
  ]);

  return <DialerManager phoneNumbers={phoneNumbers ?? []} initialLists={lists ?? []} />;
}
