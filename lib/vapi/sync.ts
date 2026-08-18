import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
// Import the specific submodules, not the @/lib/knowledge-base barrel —
// see lib/knowledge-base/pdf.ts's top comment for why.
import { formatKnowledgeBaseForPrompt } from "@/lib/knowledge-base/format";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { Widget } from "@/types/database";
import { updateVapiAssistant, DEFAULT_VAPI_FIRST_MESSAGE } from "./assistants";

// Single place that knows how to turn a widget + its extra settings into an
// up-to-date Vapi assistant — used by every call site that can change
// something the assistant depends on (name/prompt/opening message in
// app/api/customer/widgets/[id]/route.ts, knowledge base sources in
// app/api/customer/widgets/[id]/knowledge-base/*). Best-effort: logs and
// swallows Vapi errors rather than failing the caller's request, same as
// the PATCH route's original inline version.
export async function syncWidgetToVapiAssistant(widget: Widget, extra: Record<string, unknown>): Promise<void> {
  const vapiAssistantId = typeof extra.vapiAssistantId === "string" ? extra.vapiAssistantId : null;
  if (!vapiAssistantId || !widget.llm_model_id) return;

  const supabase = getAdminClient();
  const { data: llmModel } = await supabase
    .from("llm_models")
    .select("provider")
    .eq("id", widget.llm_model_id)
    .maybeSingle();

  if (llmModel?.provider !== "vapi") return;

  const knowledgeBase = formatKnowledgeBaseForPrompt(
    (extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? []
  );
  const basePrompt = widget.system_prompt ?? (await getDefaultSystemPrompt());
  const systemPrompt = [basePrompt, knowledgeBase].filter(Boolean).join("\n\n");

  try {
    await updateVapiAssistant(vapiAssistantId, {
      name: widget.name,
      systemPrompt,
      firstMessage: widget.opening_message ?? DEFAULT_VAPI_FIRST_MESSAGE,
    });
  } catch (err) {
    console.error("Failed to sync widget to Vapi assistant:", err);
  }
}
