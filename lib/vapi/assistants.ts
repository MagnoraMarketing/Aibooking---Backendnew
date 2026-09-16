import "server-only";
import { getVapiVoiceTemplateAssistantId } from "@/lib/settings/platform";
import { DEFAULT_VOICE_GENDER, FALLBACK_VOICE_BY_GENDER, type VapiVoiceGender } from "./voice-gender";
import { getPublicAppUrl, isPubliclyReachableAppUrl } from "@/lib/app-url";
import { vapiFetch } from "./client";

export type { VapiVoiceGender };

export interface VapiAssistantParams {
  name: string;
  systemPrompt: string;
  firstMessage: string;
  // "male"/"female" picks up the voice from the matching admin-configured
  // template assistant (see resolveTemplate below); null/undefined falls
  // back to the platform's original fixed voice and model.
  voiceGender?: VapiVoiceGender | null;
  // Vapi's own call limits. Omitted rather than sent as null when unset, so
  // an assistant keeps whatever Vapi defaults to instead of being handed a
  // value we invented.
  silenceTimeoutSeconds?: number | null;
  maxDurationSeconds?: number | null;
}

// The model the widget agent runs on is not a customer choice: it is
// whatever the master admin has configured on the Vapi template assistant
// (see resolveTemplate below), exactly like the voice. This constant is only
// the floor for when no template is configured, or its model block can't be
// read — a fast/cheap Claude model rather than getSummarizationModelName
// (tuned for background summarization quality, not per-turn voice latency),
// since a realtime voice call has no room for a slower model.
const FALLBACK_MODEL_PROVIDER = "anthropic";
const FALLBACK_MODEL_NAME = "claude-haiku-4-5-20251001";

interface VapiTemplateAssistant {
  voice?: Record<string, unknown>;
  model?: Record<string, unknown>;
}

// Reads the master-admin-configured "template" assistant (one for "male",
// one for "female") that widget assistants are cloned from, rather than
// storing voice/model settings ourselves — the admin builds and tunes each
// template directly in Vapi's own dashboard, and we mirror whatever it is
// currently set to. Fetched once per assistant build: both resolveVoiceConfig
// and resolveModelConfig read the same response.
async function resolveTemplate(gender: VapiVoiceGender): Promise<VapiTemplateAssistant | null> {
  const templateAssistantId = await getVapiVoiceTemplateAssistantId(gender);
  if (!templateAssistantId) {
    console.error(
      `No Vapi ${gender} voice template configured — using the built-in ${gender} fallback voice and model.`
    );
    return null;
  }

  try {
    const response = await vapiFetch(`/assistant/${encodeURIComponent(templateAssistantId)}`, { method: "GET" });
    return (await response.json()) as VapiTemplateAssistant;
  } catch (err) {
    console.error(`Failed to read Vapi ${gender} voice template (${templateAssistantId}):`, err);
    return null;
  }
}

// Every failure path here falls back to a voice OF THE REQUESTED GENDER,
// never to one fixed voice: a customer who picked "Dame" and got a male
// voice back because a template was unset is a worse outcome than a
// slightly different female voice, and one they can't diagnose or fix from
// the dashboard.
function resolveVoiceConfig(template: VapiTemplateAssistant | null, gender: VapiVoiceGender): Record<string, unknown> {
  const fallback = FALLBACK_VOICE_BY_GENDER[gender];
  if (!template) return fallback;

  if (!template.voice) {
    console.error(`Vapi ${gender} voice template has no voice block — using the fallback voice.`);
    return fallback;
  }
  return template.voice;
}

// Takes only the engine (provider + model name, and the generation knobs the
// admin tuned) from the template. The system prompt and the tools are built
// per widget below and must never come from the template — cloning its
// `messages` would replace every customer's prompt with the admin's.
function resolveModelConfig(template: VapiTemplateAssistant | null, gender: VapiVoiceGender): Record<string, unknown> {
  const fallback = { provider: FALLBACK_MODEL_PROVIDER, model: FALLBACK_MODEL_NAME };
  if (!template) return fallback;

  const model = template.model;
  if (!model || typeof model.provider !== "string" || typeof model.model !== "string") {
    console.error(`Vapi ${gender} voice template has no usable model block — using ${FALLBACK_MODEL_NAME}.`);
    return fallback;
  }

  return {
    provider: model.provider,
    model: model.model,
    ...(typeof model.temperature === "number" ? { temperature: model.temperature } : {}),
    ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
  };
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
  if (!secret) {
    console.warn(
      "[vapi] VAPI_WEBHOOK_SECRET is not set — assistants are created without a serverUrl, so call events, " +
        "per-call billing and the booking tools will never reach us."
    );
    return {};
  }

  // Vapi has to reach this URL from its own servers, so a localhost fallback
  // is worse than none: the assistant would be created with a serverUrl that
  // silently never resolves. getPublicAppUrl covers the common case of
  // NEXT_PUBLIC_APP_URL simply not being set on a Vercel deployment.
  if (!isPubliclyReachableAppUrl()) {
    console.warn(
      `[vapi] ${getPublicAppUrl()} is not publicly reachable — assistants are created without a serverUrl, so ` +
        "call events, per-call billing and the booking tools will never reach us. Set NEXT_PUBLIC_APP_URL."
    );
    return {};
  }

  return { serverUrl: `${getPublicAppUrl()}/api/webhooks/vapi`, serverUrlSecret: secret };
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

// Transcriber is still fixed (Soniox STT RT v5) — voice and model both come
// from whichever male/female template the customer's widget is set to (see
// VapiAssistantParams.voiceGender), read in a single fetch.
// Booking tools are attached only for a widget whose calendar is connected
// and whose booking_enabled gate is on (see lib/vapi/sync.ts).
async function buildAssistantBody(
  params: VapiAssistantParams,
  includeBookingTools: boolean = false,
  extraTools: unknown[] = []
) {
  const gender = params.voiceGender ?? DEFAULT_VOICE_GENDER;
  const template = await resolveTemplate(gender);

  const model: Record<string, unknown> = {
    ...resolveModelConfig(template, gender),
    messages: [{ role: "system", content: params.systemPrompt }],
  };

  // Sent as an empty list when nothing is enabled, not omitted — a PATCH that
  // leaves the key out would let tools linger on an assistant whose booking
  // (or webshop) was switched back off.
  //
  // `extraTools` is how the Shopify integration adds its own tools without
  // this module having to know anything about webshops; lib/vapi/sync.ts
  // decides which ones a given widget gets.
  model.tools = [...(includeBookingTools ? buildBookingTools() : []), ...extraTools];

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
    voice: resolveVoiceConfig(template, gender),
    ...(typeof params.silenceTimeoutSeconds === "number"
      ? { silenceTimeoutSeconds: params.silenceTimeoutSeconds }
      : {}),
    ...(typeof params.maxDurationSeconds === "number" ? { maxDurationSeconds: params.maxDurationSeconds } : {}),
    ...webhookConfig(),
  };
}

export async function createVapiAssistant(
  params: VapiAssistantParams,
  includeBookingTools = false,
  extraTools: unknown[] = []
): Promise<{ id: string }> {
  const response = await vapiFetch("/assistant", {
    method: "POST",
    body: JSON.stringify(await buildAssistantBody(params, includeBookingTools, extraTools)),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

// Vapi retires voices, and it refuses the whole PATCH when one is named:
//
//   "The Lily voice is part of a legacy voice set that is being phased out,
//    and assistants cannot be updated to use this voice."
//
// That took the rest of the update down with it — the system prompt, the
// knowledge base and the Shopify/booking tools all travel in the same PATCH,
// so a stale voice name silently stopped every one of them from reaching the
// assistant. The voice is the least important thing in that payload.
function isVoiceRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /voice/i.test(message) && /(400|not supported|phased out|legacy)/i.test(message);
}

export async function updateVapiAssistant(
  assistantId: string,
  params: VapiAssistantParams,
  includeBookingTools = false,
  extraTools: unknown[] = []
): Promise<void> {
  const body = await buildAssistantBody(params, includeBookingTools, extraTools);
  const path = `/assistant/${encodeURIComponent(assistantId)}`;

  try {
    await vapiFetch(path, { method: "PATCH", body: JSON.stringify(body) });
  } catch (err) {
    if (!isVoiceRejection(err)) throw err;

    // Retry without the voice: the assistant keeps whatever voice it already
    // had, and everything else in the update still lands. Loud, because the
    // configured voice is now wrong and someone has to pick another one.
    const { voice: rejectedVoice, ...withoutVoice } = body;
    console.error(
      `[vapi] Assistant ${assistantId}: voice rejected (${JSON.stringify(rejectedVoice)}). ` +
        "Retrying without it so the prompt, knowledge base and tools still sync. " +
        "Configure the voice templates, or set VAPI_FALLBACK_VOICE_FEMALE / VAPI_FALLBACK_VOICE_MALE " +
        "to a voice Vapi still supports.",
      err
    );
    await vapiFetch(path, { method: "PATCH", body: JSON.stringify(withoutVoice) });
  }
}
