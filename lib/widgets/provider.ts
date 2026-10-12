import "server-only";
import { getAdminClient } from "@/lib/database/admin";

// Whether this agent places its outbound calls through the customer's own
// Twilio subaccount rather than through Vapi.
//
// The llm_models row an agent points at decides more than which model
// answers: an older 'anthropic' agent dials Twilio directly, everything else
// goes through Vapi (the same split lib/phone-numbers/service.ts uses when a
// number is provisioned). The outbound launch route has always branched on
// exactly this; the campaign-create route now needs the same answer, and a
// second inline copy of the lookup is how the two drift apart.
//
// Deliberately 'anthropic or not', not 'vapi or not': an agent with no model
// row at all keeps taking the Vapi path, where it fails with "denne agent har
// ikke en Vapi-assistent" — the message that says what is actually wrong —
// rather than being told to pick a Twilio number it has no account for.
export async function widgetDialsThroughTwilio(widgetId: string): Promise<boolean> {
  const supabase = getAdminClient();

  const { data: widget } = await supabase
    .from("widgets")
    .select("llm_model_id")
    .eq("id", widgetId)
    .maybeSingle();
  if (!widget?.llm_model_id) return false;

  const { data: llmModel } = await supabase
    .from("llm_models")
    .select("provider")
    .eq("id", widget.llm_model_id)
    .maybeSingle();

  return llmModel?.provider === "anthropic";
}
