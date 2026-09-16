import "server-only";
import { getAdminClient } from "@/lib/database/admin";

// Which widget a Vapi assistant belongs to.
//
// An agent can have two assistants, because the two jobs are not the same
// conversation: the one that answers the phone is the receptionist we build
// and keep in sync, and the one that places campaign calls can be a separate
// persona maintained in Vapi's own dashboard (widget_settings.extra
// .vapiOutboundAssistantId — see the outbound launch route). Either of them
// can be the assistant on a call, so both have to lead back here.
//
// This is the isolation boundary for tool calls and the attribution for
// billing: ids are matched against the settings rows we wrote ourselves, so
// an assistant can only ever resolve to its own customer's widget. Never
// take the widget from a webhook payload's own fields.
export async function findWidgetIdForAssistant(
  assistantId: string,
  supabase: ReturnType<typeof getAdminClient> = getAdminClient()
): Promise<string | null> {
  const { data: inbound } = await supabase
    .from("widget_settings")
    .select("widget_id")
    .eq("extra->>vapiAssistantId", assistantId)
    .maybeSingle();
  if (inbound) return inbound.widget_id;

  const { data: outbound } = await supabase
    .from("widget_settings")
    .select("widget_id")
    .eq("extra->>vapiOutboundAssistantId", assistantId)
    .maybeSingle();
  return outbound?.widget_id ?? null;
}

// The assistant that should place this agent's outbound calls: its own
// campaign persona where one is configured, otherwise the assistant that
// answers the phone.
//
// Nothing ever syncs the outbound one. It is written by hand in Vapi, which
// is the whole reason for having it — pushing the agent's inbound prompt,
// voice and tools over it (as lib/vapi/sync.ts does for the main assistant)
// would erase the thing that makes it different.
export function outboundAssistantId(extra: Record<string, unknown>): string | null {
  const outbound = extra.vapiOutboundAssistantId;
  if (typeof outbound === "string" && outbound.trim()) return outbound;
  const inbound = extra.vapiAssistantId;
  return typeof inbound === "string" && inbound.trim() ? inbound : null;
}
