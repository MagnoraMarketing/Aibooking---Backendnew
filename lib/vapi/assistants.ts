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

// The tools a booking-enabled assistant may call mid-call. They're declared
// on the model (Vapi's top-level `functions` is the deprecated shape) and
// execute in app/api/webhooks/vapi — the assistant's serverUrl — so Cal.com
// credentials stay server-side.
//
// The descriptions carry the guardrail that matters most: the agent must not
// invent a booking. Offering a time it hasn't verified, or confirming one the
// booking call didn't return, is the single worst failure mode here.
function buildBookingTools() {
  return [
    {
      type: "function",
      function: {
        name: "check_availability",
        description:
          "Slår ledige tider op i virksomhedens kalender. Skal altid kaldes før du nævner eller foreslår et tidspunkt — du må aldrig gætte en ledig tid.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Ønsket dato som YYYY-MM-DD. Udelad for at se de første ledige tider fra i dag.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_booking",
        description:
          "Opretter bookingen. Kald kun denne med et tidspunkt som check_availability lige har returneret, og først når kunden har sagt ja til netop det tidspunkt. Bekræft aldrig en booking over for kunden før denne funktion har svaret at den lykkedes.",
        parameters: {
          type: "object",
          properties: {
            start_time: {
              type: "string",
              description: "Starttidspunkt i ISO 8601 med tidszone, fx 2026-03-15T14:00:00+01:00.",
            },
            customer_name: { type: "string", description: "Kundens fulde navn." },
            customer_email: { type: "string", description: "Kundens email til bekræftelsen." },
          },
          required: ["start_time", "customer_name", "customer_email"],
        },
      },
    },
  ];
}

// Fixed transcriber/voice combination, matching how this account's
// hand-configured Vapi assistants are already set up (Soniox STT RT v5,
// Vapi's own "Elliot" voice) — not per-widget configurable yet.
function buildAssistantBody(params: VapiAssistantParams, modelName: string, includeBookingTools: boolean) {
  const model: Record<string, unknown> = {
    provider: "anthropic",
    model: modelName,
    messages: [{ role: "system", content: params.systemPrompt }],
  };

  // Sent as an empty list when booking is off, not omitted — a PATCH that
  // leaves the key out would let tools linger on an assistant whose booking
  // was switched back off.
  model.tools = includeBookingTools ? buildBookingTools() : [];

  return {
    name: params.name,
    firstMessage: params.firstMessage,
    model,
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
}

export async function createVapiAssistant(
  params: VapiAssistantParams,
  includeBookingTools = false
): Promise<{ id: string }> {
  const modelName = await resolveModelName();
  const response = await vapiFetch("/assistant", {
    method: "POST",
    body: JSON.stringify(buildAssistantBody(params, modelName, includeBookingTools)),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export async function updateVapiAssistant(
  assistantId: string,
  params: VapiAssistantParams,
  includeBookingTools = false
): Promise<void> {
  const modelName = await resolveModelName();
  await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, {
    method: "PATCH",
    body: JSON.stringify(buildAssistantBody(params, modelName, includeBookingTools)),
  });
}
