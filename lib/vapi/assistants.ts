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
    {
      type: "function",
      function: {
        name: "get_event_types",
        description:
          "Viser hvilke ydelser virksomheden kan bookes til, og hvor lang tid hver tager. Brug den hvis du er i tvivl om hvad kunden kan bestille — opfind aldrig en ydelse.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_booking",
        description:
          "Finder kundens eksisterende tid ud fra deres email. Skal altid kaldes før du flytter eller aflyser noget, så du ved hvilken tid der er tale om.",
        parameters: {
          type: "object",
          properties: {
            customer_email: { type: "string", description: "Den email kunden booked med." },
          },
          required: ["customer_email"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reschedule_booking",
        description:
          "Flytter kundens eksisterende tid til et nyt tidspunkt. Brug kun et tidspunkt check_availability lige har bekræftet ledigt, og først når kunden har sagt ja til det. Sig altid det nye tidspunkt højt bagefter.",
        parameters: {
          type: "object",
          properties: {
            customer_email: { type: "string", description: "Den email kunden booked med." },
            new_start_time: {
              type: "string",
              description: "Det nye starttidspunkt i ISO 8601 med tidszone.",
            },
          },
          required: ["customer_email", "new_start_time"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "cancel_booking",
        description:
          "Aflyser kundens eksisterende tid. Bekræft altid med kunden hvilken tid der aflyses, før du kalder denne.",
        parameters: {
          type: "object",
          properties: {
            customer_email: { type: "string", description: "Den email kunden booked med." },
            reason: { type: "string", description: "Kundens grund til aflysningen, hvis oplyst." },
          },
          required: ["customer_email"],
        },
      },
    },
  ];
}

// Transcriber is still fixed (Soniox STT RT v5) — voice now comes from
// resolveVoiceConfig, cloned from whichever male/female template the
// customer's widget is set to (see VapiAssistantParams.voiceGender).
// Booking tools are attached only for a widget whose calendar is connected
// and whose booking_enabled gate is on (see lib/vapi/sync.ts).
async function buildAssistantBody(
  params: VapiAssistantParams,
  modelName: string,
  includeBookingTools: boolean = false
) {
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
    voice: await resolveVoiceConfig(params.voiceGender),
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
    body: JSON.stringify(await buildAssistantBody(params, modelName, includeBookingTools)),
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
    body: JSON.stringify(await buildAssistantBody(params, modelName, includeBookingTools)),
  });
}
