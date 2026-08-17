import "server-only";
import type { Vapi } from "@vapi-ai/server-sdk";
import type { Widget } from "@/types/database";
import { getTranscriberLanguage } from "@/lib/widgets/languages";
import { buildDefaultFirstMessage, buildDefaultSystemPrompt } from "./prompt-template";
import { vapiEnv } from "./env";
import type { AgentCapabilities } from "./types";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// Vapi's CreateAssistantDto has no `server.secret` field (unlike, say,
// Stripe's HMAC signature scheme) — the current SDK only exposes
// `server.url`/`server.headers`/`server.credentialId`, and header-based
// verification would require provisioning a separate Bearer Token
// credential resource via the Vapi dashboard/API. Simpler and fully within
// our own control: embed VAPI_WEBHOOK_SECRET as a query param on the
// webhook URL itself and verify it there (see lib/vapi/webhook.ts) — Vapi
// just POSTs to whatever URL we register, so this works regardless of
// what header-auth options Vapi does or doesn't forward.
export function buildVapiWebhookUrl(): string {
  const base = `${getAppUrl()}/api/webhooks/vapi`;
  return vapiEnv.webhookSecret ? `${base}?secret=${encodeURIComponent(vapiEnv.webhookSecret)}` : base;
}

// Builds the Vapi assistant payload from a widget row. Used for both create
// (POST /assistant) and update (PATCH /assistant/{id}) — the two DTOs share
// every field below, so the caller decides which SDK method to invoke and
// spreads this onto the `{ id }` update expects.
export function buildVapiAssistantPayload(
  widget: Widget,
  capabilities: AgentCapabilities
): Vapi.CreateAssistantDto {
  const systemPrompt =
    widget.system_prompt?.trim() ||
    buildDefaultSystemPrompt(
      {
        business_name: widget.business_name,
        business_description: widget.business_description,
        business_phone: widget.business_phone,
        business_email: widget.business_email,
        language: widget.language,
      },
      capabilities
    );

  const firstMessage =
    widget.opening_message?.trim() || widget.welcome_message?.trim() || buildDefaultFirstMessage(widget);

  const model: Vapi.CreateAssistantDtoModel =
    widget.vapi_llm_provider === "anthropic"
      ? ({
          provider: "anthropic",
          model: widget.vapi_llm_model as Vapi.AnthropicModelModel,
          messages: [{ role: "system", content: systemPrompt }],
        } as Vapi.CreateAssistantDtoModel.Anthropic)
      : ({
          provider: "openai",
          model: widget.vapi_llm_model as Vapi.OpenAiModelModel,
          messages: [{ role: "system", content: systemPrompt }],
        } as Vapi.CreateAssistantDtoModel.Openai);

  const voiceProvider = widget.vapi_voice_provider || "vapi";
  const voice = { provider: voiceProvider, voiceId: widget.vapi_voice_id || "Elliot" } as Vapi.CreateAssistantDtoVoice;

  const server: Vapi.Server = { url: buildVapiWebhookUrl() };

  return {
    name: widget.name,
    firstMessage,
    model,
    voice,
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: getTranscriberLanguage(widget.language) as Vapi.DeepgramTranscriberLanguage,
    } as Vapi.CreateAssistantDtoTranscriber,
    server,
    serverMessages: ["status-update", "end-of-call-report", "hang", "transcript"] as Vapi.CreateAssistantDtoServerMessagesItem[],
    metadata: { aibookingWidgetId: widget.id, aibookingCustomerId: widget.customer_id },
  };
}
