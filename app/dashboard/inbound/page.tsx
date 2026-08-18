import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { InboundManager } from "@/components/dashboard/inbound-manager";
import type { Customer, PhoneNumber, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export type PhoneNumberRow = PhoneNumber;

export default async function InboundPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: phoneNumbers }, { data: customer }, { data: subscription }] = await Promise.all([
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
    supabase.from("customers").select("intro_offer_used_at").eq("id", customerId).single<Pick<Customer, "intro_offer_used_at">>(),
    supabase.from("subscriptions").select("id").eq("customer_id", customerId).maybeSingle(),
  ]);

  return (
    <InboundManager
      widgets={widgets ?? []}
      initialPhoneNumbers={phoneNumbers ?? []}
      introOfferAvailable={!customer?.intro_offer_used_at && !subscription}
    />
  );
}
