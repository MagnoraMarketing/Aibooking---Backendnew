import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { InboundManager } from "@/components/dashboard/inbound-manager";
import { AgentsManager } from "@/components/dashboard/agents-manager";
import { PHONE_NUMBER_CLIENT_COLUMNS } from "@/lib/phone-numbers";
import type { Customer, LLMModel, PhoneNumber, VoiceModel, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export type PhoneNumberRow = PhoneNumber;

export default async function InboundPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [
    { data: widgets },
    { data: phoneNumbers },
    { data: customer },
    { data: subscription },
    { data: allLlmModels },
    { data: createFlowLlmModels },
    { data: voiceModels },
  ] = await Promise.all([
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
    supabase.from("customers").select("intro_offer_used_at").eq("id", customerId).single<Pick<Customer, "intro_offer_used_at">>(),
    supabase.from("subscriptions").select("id").eq("customer_id", customerId).maybeSingle(),
    supabase.from("llm_models").select("id, provider"),
    supabase
      .from("llm_models")
      .select("*")
      .eq("active", true)
      .eq("show_in_create_flow", true)
      .order("display_name")
      .returns<LLMModel[]>(),
    supabase.from("voice_models").select("*").eq("active", true).order("name").returns<VoiceModel[]>(),
  ]);

  // Telefon (Inbound/Outbound) agents only, here and in InboundManager's own
  // "Agent" picker — attaching a phone number to a Voice Widget agent isn't
  // part of the type-based flow (see agent-creation-wizard.tsx). Widget
  // Agents management lives on its own page/nav entry instead.
  const providerByModelId = new Map((allLlmModels ?? []).map((m) => [m.id, m.provider]));
  const phoneAgents = (widgets ?? []).filter((w) => w.llm_model_id && providerByModelId.get(w.llm_model_id) === "anthropic");

  return (
    <div className="space-y-10">
      <AgentsManager
        initialWidgets={phoneAgents}
        llmModels={createFlowLlmModels ?? []}
        voiceModels={voiceModels ?? []}
        embedCodeUnlocked={false}
        trialDaysRemaining={0}
        pkg={null}
        agentType="phone"
      />

      <InboundManager
        widgets={phoneAgents}
        initialPhoneNumbers={phoneNumbers ?? []}
        introOfferAvailable={!customer?.intro_offer_used_at && !subscription}
      />
    </div>
  );
}
