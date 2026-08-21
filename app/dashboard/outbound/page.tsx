import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { OutboundManager } from "@/components/dashboard/outbound-manager";
import { PHONE_NUMBER_CLIENT_COLUMNS } from "@/lib/phone-numbers";
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

  const [{ data: widgets }, { data: phoneNumbers }, { data: campaigns }, { data: allLlmModels }] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<Widget[]>(),
    supabase
      .from("phone_numbers")
      .select(PHONE_NUMBER_CLIENT_COLUMNS)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<PhoneNumberRow[]>(),
    supabase
      .from("outbound_campaigns")
      .select("*, outbound_campaign_contacts(count)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<CampaignRow[]>(),
    supabase.from("llm_models").select("id, provider"),
  ]);

  // Telefon (Inbound/Outbound) agents only — same split as the Inbound page
  // (see agent-creation-wizard.tsx). Widget Agents aren't relevant to
  // outbound calling campaigns.
  const providerByModelId = new Map((allLlmModels ?? []).map((m) => [m.id, m.provider]));
  const phoneAgents = (widgets ?? []).filter((w) => w.llm_model_id && providerByModelId.get(w.llm_model_id) === "anthropic");

  return (
    <OutboundManager
      widgets={phoneAgents}
      phoneNumbers={phoneNumbers ?? []}
      initialCampaigns={campaigns ?? []}
    />
  );
}
