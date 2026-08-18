import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { OutboundManager } from "@/components/dashboard/outbound-manager";
import type { Widget } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";

export const dynamic = "force-dynamic";

export interface CampaignRow {
  id: string;
  widget_id: string;
  phone_number_id: string;
  name: string;
  status: "draft" | "launched";
  created_at: string;
  launched_at: string | null;
  outbound_campaign_contacts: { count: number }[];
}

export default async function OutboundPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: phoneNumbers }, { data: campaigns }] = await Promise.all([
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
    supabase
      .from("outbound_campaigns")
      .select("*, outbound_campaign_contacts(count)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<CampaignRow[]>(),
  ]);

  return (
    <OutboundManager
      widgets={widgets ?? []}
      phoneNumbers={phoneNumbers ?? []}
      initialCampaigns={campaigns ?? []}
    />
  );
}
