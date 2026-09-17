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
  // Settings (see 0039_outbound_campaign_settings.sql). Present on every
  // campaign — the columns have defaults — so the edit form always has
  // something to show.
  agent_instruction: string | null;
  call_window_start: string;
  call_window_end: string;
  call_days: number[];
  call_timezone: string;
  max_concurrent_calls: number;
  max_attempts: number;
  retry_after_minutes: number;
}

export default async function OutboundPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: phoneNumbers }, { data: campaigns }, { data: twilioDirectModels }] =
    await Promise.all([
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
    // Which models dial Twilio directly rather than through Vapi — the split
    // lib/widgets/provider.ts makes server-side for the routes. The picker
    // needs it too, so it never offers a number the agent cannot dial from.
    supabase.from("llm_models").select("id").eq("provider", "anthropic").returns<{ id: string }[]>(),
  ]);

  // Telefon (Inbound/Outbound) agents only — same split as the Inbound page
  // (see agent-creation-wizard.tsx). Widget Agents aren't relevant to
  // outbound calling campaigns.
  const phoneAgents = (widgets ?? []).filter((w) => w.agent_type === "phone");

  const twilioDirectModelIds = new Set((twilioDirectModels ?? []).map((model) => model.id));
  const twilioDirectWidgetIds = phoneAgents
    .filter((widget) => widget.llm_model_id && twilioDirectModelIds.has(widget.llm_model_id))
    .map((widget) => widget.id);

  return (
    <OutboundManager
      widgets={phoneAgents}
      phoneNumbers={phoneNumbers ?? []}
      initialCampaigns={campaigns ?? []}
      twilioDirectWidgetIds={twilioDirectWidgetIds}
    />
  );
}
