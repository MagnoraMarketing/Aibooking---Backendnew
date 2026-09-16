import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
// Import the specific submodules, not the @/lib/knowledge-base barrel —
// see lib/knowledge-base/pdf.ts's top comment for why.
import { formatKnowledgeBaseForPrompt } from "@/lib/knowledge-base/format";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { Widget } from "@/types/database";
import { defaultGreeting, withLanguageDirective } from "@/lib/i18n/agent-content";
// Imported from the submodules rather than the @/lib/shopify barrel: the
// barrel also re-exports lib/shopify/sync.ts, which imports @/lib/vapi — and
// that would be an import cycle straight back into this file.
import { resolveShopifyCapabilities } from "@/lib/shopify/agent-tools";
import { buildShopifyVapiTools } from "@/lib/shopify/tool-definitions";
import { updateVapiAssistant, type VapiVoiceGender } from "./assistants";
import { DEFAULT_VOICE_GENDER } from "./voice-gender";

// Single place that knows how to turn a widget + its extra settings into an
// up-to-date Vapi assistant — used by every call site that can change
// something the assistant depends on (name/prompt/opening message in
// app/api/customer/widgets/[id]/route.ts, knowledge base sources in
// app/api/customer/widgets/[id]/knowledge-base/*). Best-effort: logs and
// swallows Vapi errors rather than failing the caller's request, same as
// the PATCH route's original inline version.
// What one sync did, for callers that need to report it. Every existing
// caller ignores the return value and keeps the old best-effort behaviour;
// only the admin bulk re-sync reads it, because "we tried 30 assistants" is
// useless without knowing which ones landed.
export type VapiSyncOutcome =
  | { status: "synced" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function syncWidgetToVapiAssistant(
  widget: Widget,
  extra: Record<string, unknown>
): Promise<VapiSyncOutcome> {
  const vapiAssistantId = typeof extra.vapiAssistantId === "string" ? extra.vapiAssistantId : null;
  if (!vapiAssistantId) return { status: "skipped", reason: "no_vapi_assistant" };
  if (!widget.llm_model_id) return { status: "skipped", reason: "no_llm_model" };

  const supabase = getAdminClient();
  const { data: llmModel } = await supabase
    .from("llm_models")
    .select("provider")
    .eq("id", widget.llm_model_id)
    .maybeSingle();

  if (llmModel?.provider !== "vapi") return { status: "skipped", reason: "not_a_vapi_widget" };

  // Check if booking is enabled to include booking tools
  const includeBookingTools = widget.booking_enabled ?? false;

  const knowledgeBase = formatKnowledgeBaseForPrompt(
    (extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? []
  );
  const basePrompt = widget.system_prompt ?? (await getDefaultSystemPrompt());
  const systemPrompt = withLanguageDirective(
    [basePrompt, knowledgeBase].filter(Boolean).join("\n\n"),
    widget.language
  );

  // Never null: an unset choice means the platform default ("Dame"), the
  // same one the creation route stores and the UI shows preselected — see
  // lib/vapi/voice-gender.ts.
  const voiceGender = (extra.voiceGender as VapiVoiceGender | null | undefined) ?? DEFAULT_VOICE_GENDER;

  // Webshop tools are attached per capability, not per feature flag: product
  // search needs a crawled catalogue, order lookup needs a completed Shopify
  // install, and a widget can genuinely have the first without the second.
  // Giving the assistant a tool it can't fulfil would just teach it to promise
  // things — so a widget with no webshop gets neither, and the empty list in
  // buildAssistantBody clears any that a previous sync left behind.
  let shopifyTools: unknown[] = [];
  try {
    shopifyTools = buildShopifyVapiTools(await resolveShopifyCapabilities(widget.id));
  } catch (err) {
    console.error("Failed to resolve Shopify tools for assistant sync:", err);
  }

  const silenceTimeoutSeconds = typeof extra.silenceTimeoutSeconds === "number" ? extra.silenceTimeoutSeconds : null;
  const maxDurationSeconds = typeof extra.maxDurationSeconds === "number" ? extra.maxDurationSeconds : null;

  try {
    await updateVapiAssistant(
      vapiAssistantId,
      {
        name: widget.name,
        systemPrompt,
        firstMessage: widget.opening_message ?? defaultGreeting(widget.language),
        voiceGender,
        silenceTimeoutSeconds,
        maxDurationSeconds,
      },
      includeBookingTools,
      shopifyTools
    );
    return { status: "synced" };
  } catch (err) {
    console.error("Failed to sync widget to Vapi assistant:", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
