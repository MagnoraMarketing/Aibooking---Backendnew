import "server-only";
import { getVapiVoiceTemplateAssistantId, type VapiVoiceGender } from "@/lib/settings/platform";
import { vapiFetch } from "./client";

export type { VapiVoiceGender };

export interface VapiAssistantParams {
  name: string;
  systemPrompt: string;
  firstMessage: string;
  // "male"/"female" picks up the voice from the matching admin-configured
  // template assistant (see resolveVoiceConfig below); null/undefined falls
  // back to the platform's original fixed voice.
  voiceGender?: VapiVoiceGender | null;
}

// Fixed to a fast/cheap Claude model rather than getSummarizationModelName
// (tuned for background summarization quality, not per-turn voice latency)
// — every Vapi widget agent uses this, regardless of the customer's own
// choices, since a realtime voice call has no room for a slower model.
const VAPI_ASSISTANT_MODEL = "claude-haiku-4-5-20251001";

async function resolveModelName(): Promise<string> {
  return VAPI_ASSISTANT_MODEL;
}

const FALLBACK_VOICE = { provider: "vapi", version: 2, voiceId: "Elliot" };

// Clones the `voice` block from a master-admin-configured "template"
// assistant (one for "male", one for "female") rather than storing voice
// settings ourselves — the admin builds/tunes each template directly in
// Vapi's own dashboard, and we just mirror whatever it's currently set to.
// Best-effort: no template configured yet, or Vapi is unreachable, falls
// back to the platform's original fixed voice rather than failing the
// caller's create/update.
async function resolveVoiceConfig(voiceGender: VapiVoiceGender | null | undefined): Promise<Record<string, unknown>> {
  if (!voiceGender) return FALLBACK_VOICE;

  const templateAssistantId = await getVapiVoiceTemplateAssistantId(voiceGender);
  if (!templateAssistantId) return FALLBACK_VOICE;

  try {
    const response = await vapiFetch(`/assistant/${encodeURIComponent(templateAssistantId)}`, { method: "GET" });
    const data = (await response.json()) as { voice?: Record<string, unknown> };
    return data.voice ?? FALLBACK_VOICE;
  } catch (err) {
    console.error(`Failed to read Vapi ${voiceGender} voice template (${templateAssistantId}):`, err);
    return FALLBACK_VOICE;
  }
}

// Without this, Vapi has nowhere to send call events (transcripts,
// recordings, end-of-call-report) — app/api/webhooks/vapi/route.ts would
// simply never be called, silently breaking phone-call billing
// (recordAndBillCall) and the vapi_events audit log for every assistant
// this platform creates. Only set when VAPI_WEBHOOK_SECRET is actually
// configured — a serverUrl with no secret to hand Vapi would just make
// every delivery fail signature verification instead of never being sent.
function webhookConfig(): { serverUrl: string; serverUrlSecret: string } | Record<string, never> {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!secret || !appUrl) return {};
  return { serverUrl: `${appUrl}/api/webhooks/vapi`, serverUrlSecret: secret };
}

// Transcriber is still fixed (Soniox STT RT v5) — voice now comes from
// resolveVoiceConfig, cloned from whichever male/female template the
// customer's widget is set to (see VapiAssistantParams.voiceGender).
async function buildAssistantBody(params: VapiAssistantParams, modelName: string) {
  return {
    name: params.name,
    firstMessage: params.firstMessage,
    model: {
      provider: "anthropic",
      model: modelName,
      messages: [{ role: "system", content: params.systemPrompt }],
    },
    // `languageHints` was removed live from a production 400: "transcriber
    // .property languageHints should not exist" — Vapi's current API
    // rejects it for the soniox/stt-rt-v5 transcriber, even though it's
    // documented for other providers. Soniox's stt-rt-v5 auto-detects
    // language, so no replacement field is needed here.
    transcriber: {
      provider: "soniox",
      model: "stt-rt-v5",
    },
    voice: await resolveVoiceConfig(params.voiceGender),
    ...webhookConfig(),
  };
}

export async function createVapiAssistant(params: VapiAssistantParams): Promise<{ id: string }> {
  const modelName = await resolveModelName();
  const response = await vapiFetch("/assistant", {
    method: "POST",
    body: JSON.stringify(await buildAssistantBody(params, modelName)),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export async function updateVapiAssistant(assistantId: string, params: VapiAssistantParams): Promise<void> {
  const modelName = await resolveModelName();
  await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, {
    method: "PATCH",
    body: JSON.stringify(await buildAssistantBody(params, modelName)),
  });
}
