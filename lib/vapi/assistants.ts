import "server-only";
import { getSummarizationModelName } from "@/lib/settings/platform";
import { vapiFetch } from "./client";

// Used whenever a widget doesn't have its own opening_message yet (e.g. a
// freshly created agent) — same role as DEFAULT_REALTIME_INSTRUCTIONS in
// lib/realtime/index.ts's caller, but Vapi calls it firstMessage rather
// than instructions.
export const DEFAULT_VAPI_FIRST_MESSAGE = "Hej, hvordan kan jeg hjælpe dig?";

export interface VapiAssistantParams {
  name: string;
  systemPrompt: string;
  firstMessage: string;
}

// Same Claude model the rest of the app treats as "the" canonical Anthropic
// model for behind-the-scenes calls not tied to a specific widget's own LLM
// choice (see getSummarizationModelName's own doc comment) — reused here
// rather than inventing a second notion of "default model".
async function resolveModelName(): Promise<string> {
  return getSummarizationModelName();
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

// Booking tools for Vapi assistants when calendar integration is available
function buildBookingTools() {
  return [
    {
      name: "check_availability",
      description: "Tjek ledige mødetider i kundens kalender. Skal altid bruges før man foreslår en tid.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Dato i format YYYY-MM-DD (valgfrit, hvis ikke angivet bruges i dag)",
          },
        },
      },
    },
    {
      name: "create_booking",
      description: "Book et møde på en specifik tid. Skal kun bruges efter at kunden har bekræftet tidspunktet.",
      parameters: {
        type: "object",
        properties: {
          start_time: {
            type: "string",
            description: "Starttidspunkt i ISO 8601 format (fx 2026-03-15T14:00:00+01:00)",
          },
          customer_name: {
            type: "string",
            description: "Kundens fulde navn",
          },
          customer_email: {
            type: "string",
            description: "Kundens email-adresse",
          },
        },
        required: ["start_time", "customer_name", "customer_email"],
      },
    },
  ];
}

// Fixed transcriber/voice combination, matching how this account's
// hand-configured Vapi assistants are already set up (Soniox STT RT v5,
// Vapi's own "Elliot" voice) — not per-widget configurable yet.
function buildAssistantBody(params: VapiAssistantParams, modelName: string, includeBookingTools: boolean = false) {
  const body: Record<string, unknown> = {
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
    voice: {
      provider: "vapi",
      version: 2,
      voiceId: "Elliot",
    },
    ...webhookConfig(),
  };

  if (includeBookingTools) {
    body.functions = buildBookingTools();
  }

  return body;
}

export async function createVapiAssistant(params: VapiAssistantParams, includeBookingTools?: boolean): Promise<{ id: string }> {
  const modelName = await resolveModelName();
  const response = await vapiFetch("/assistant", {
    method: "POST",
    body: JSON.stringify(buildAssistantBody(params, modelName, includeBookingTools ?? false)),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export async function updateVapiAssistant(assistantId: string, params: VapiAssistantParams, includeBookingTools?: boolean): Promise<void> {
  const modelName = await resolveModelName();
  await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, {
    method: "PATCH",
    body: JSON.stringify(buildAssistantBody(params, modelName, includeBookingTools ?? false)),
  });
}
