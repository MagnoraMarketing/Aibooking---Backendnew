import "server-only";
import { getAdminClient } from "@/lib/database/admin";

export interface AgentTypeUsage {
  activeAgents: number;
  totalConversations: number;
  minutesUsed: number;
}

export interface UsageByAgentType {
  widget: AgentTypeUsage;
  phone: AgentTypeUsage;
}

// Splits dashboard stats by what an agent is *for* — Voice Widget vs
// Telefon (Inbound/Outbound), the same distinction the create wizard and
// Configure Agent's tabs already key off (see agent-creation-wizard.tsx's
// module comment). Grouping by each widget's model provider is the
// consistent way to do this: conversations.channel only ever gets set to
// 'phone' by the Twilio-direct pipeline (0019_twilio_direct_voice.sql),
// leaving Vapi-routed phone calls indistinguishable from widget sessions if
// used alone — provider covers every pipeline (Vapi widget, Vapi phone
// import, Twilio-direct) since it's a property of the agent itself, not of
// how a given session happened to run.
export async function getUsageByAgentType(customerId: string): Promise<UsageByAgentType> {
  const supabase = getAdminClient();

  const [{ data: widgets }, { data: llmModels }] = await Promise.all([
    supabase.from("widgets").select("id, llm_model_id, status").eq("customer_id", customerId),
    supabase.from("llm_models").select("id, provider"),
  ]);

  const providerByModelId = new Map((llmModels ?? []).map((m) => [m.id, m.provider]));
  const phoneWidgetIds = new Set(
    (widgets ?? [])
      .filter((w) => w.llm_model_id && providerByModelId.get(w.llm_model_id) === "anthropic")
      .map((w) => w.id)
  );
  const isPhoneType = (widgetId: string) => phoneWidgetIds.has(widgetId);

  const activeAgents = (widgets ?? []).filter((w) => w.status === "active");
  const activeWidgetAgents = activeAgents.filter((w) => !isPhoneType(w.id)).length;
  const activePhoneAgents = activeAgents.filter((w) => isPhoneType(w.id)).length;

  const [{ data: conversations }, { data: sessions }] = await Promise.all([
    supabase.from("conversations").select("id, widget_id").eq("customer_id", customerId),
    supabase.from("usage_sessions").select("widget_id, billed_duration_seconds").eq("customer_id", customerId),
  ]);

  let widgetConversations = 0;
  let phoneConversations = 0;
  for (const conversation of conversations ?? []) {
    if (isPhoneType(conversation.widget_id)) phoneConversations++;
    else widgetConversations++;
  }

  let widgetSeconds = 0;
  let phoneSeconds = 0;
  for (const session of sessions ?? []) {
    if (!session.widget_id) continue;
    if (isPhoneType(session.widget_id)) phoneSeconds += session.billed_duration_seconds ?? 0;
    else widgetSeconds += session.billed_duration_seconds ?? 0;
  }

  return {
    widget: {
      activeAgents: activeWidgetAgents,
      totalConversations: widgetConversations,
      minutesUsed: Math.round((widgetSeconds / 60) * 100) / 100,
    },
    phone: {
      activeAgents: activePhoneAgents,
      totalConversations: phoneConversations,
      minutesUsed: Math.round((phoneSeconds / 60) * 100) / 100,
    },
  };
}
