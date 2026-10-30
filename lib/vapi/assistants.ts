import "server-only";
import { getVapiVoiceTemplateAssistantId } from "@/lib/settings/platform";
import { DEFAULT_VOICE_GENDER, FALLBACK_VOICE_BY_GENDER, type VapiVoiceGender } from "./voice-gender";
import { getPublicAppUrl, isPubliclyReachableAppUrl } from "@/lib/app-url";
import {
  toolWaitText,
  toolFailedText,
  withNoBookingDirective,
  withBookingFlowDirective,
  withEndCallDirective,
} from "@/lib/i18n/agent-content";
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
  // The widget's configured language (widgets.language). Decides what the
  // assistant says out loud while a tool runs — see withSpokenToolMessages.
  language?: string | null;
  // The agent this assistant belongs to, recorded in the assistant's Vapi
  // metadata. Unknown while the agent is still being created.
  widgetId?: string | null;
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
  id?: string;
  voice?: Record<string, unknown>;
  model?: Record<string, unknown>;
  transcriber?: Record<string, unknown>;
  startSpeakingPlan?: Record<string, unknown>;
  serverMessages?: unknown;
  [key: string]: unknown;
}

// Reads the master-admin-configured "template" assistant (one for "male",
// one for "female") that every agent's assistant is cloned from, rather than
// storing voice/model settings ourselves — the admin builds and tunes each
// template directly in Vapi's own dashboard, and we mirror whatever it is
// currently set to. Fetched once per assistant build: the voice, the model
// and every other cloned setting (cloneTemplateSettings) read the same
// response.
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
    const template = (await response.json()) as VapiTemplateAssistant;
    return { ...template, id: templateAssistantId };
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

  // Everything else the admin tuned on the template's model (temperature,
  // maxTokens, emotion recognition, fallbacks …) is copied too.
  const engine: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(model)) {
    if (!MODEL_FIELDS_NOT_CLONED.has(key)) engine[key] = value;
  }
  return engine;
}

// The parts of the template's model block that belong to the template, not
// to the engine: its prompt, its tools (inline or by id — a tool on the
// template, e.g. a transfer to the admin's own number, must never end up on a
// customer's agent) and its knowledge base. Each agent gets its own below.
const MODEL_FIELDS_NOT_CLONED = new Set(["messages", "tools", "toolIds", "knowledgeBase", "knowledgeBaseId"]);

// Top-level fields of a template that are never copied onto an agent's
// assistant: Vapi's own read-only bookkeeping (POST/PATCH reject them), the
// template's identity, and everything this module builds per agent
// (buildAssistantBody). Everything NOT listed here — endpointing, background
// sound, recording/analysis plans, interruption settings, voicemail
// detection, call limits … — is cloned as-is, so a new agent starts out as
// an exact copy of the "Mand"/"Dame" template the customer picked, and only
// its name, prompt, greeting, tools and webhook are its own.
const TEMPLATE_FIELDS_NOT_CLONED = new Set([
  "id",
  "orgId",
  "createdAt",
  "updatedAt",
  "isServerUrlSecretSet",
  "name",
  "firstMessage",
  "metadata",
  "model",
  "voice",
  "transcriber",
  "startSpeakingPlan",
  "server",
  "serverUrl",
  "serverUrlSecret",
  "knowledgeBase",
  "knowledgeBaseId",
]);

// Text the template SPEAKS, written in the template's own language. The
// templates are configured by the (Danish) platform team, so these are only
// copied onto an agent that also speaks Danish — an English agent saying a
// Danish goodbye is worse than Vapi's silence. Our own endCall tool and
// directive cover hanging up in every language regardless.
const TEMPLATE_LANGUAGE = "da";
const SPOKEN_TEMPLATE_FIELDS = new Set(["endCallMessage", "endCallPhrases", "voicemailMessage", "messagePlan"]);

// The webhook events this platform cannot do without: tool calls run the
// booking/webshop tools, and the end-of-call report bills the call (see
// app/api/webhooks/vapi/route.ts). A template that narrows serverMessages
// keeps its list, plus these.
const REQUIRED_SERVER_MESSAGES = ["tool-calls", "end-of-call-report"];

function cloneTemplateSettings(
  template: VapiTemplateAssistant | null,
  language: string | null | undefined
): Record<string, unknown> {
  if (!template) return {};
  const speaksTemplateLanguage = !language || language === TEMPLATE_LANGUAGE;

  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (TEMPLATE_FIELDS_NOT_CLONED.has(key)) continue;
    if (SPOKEN_TEMPLATE_FIELDS.has(key) && !speaksTemplateLanguage) continue;
    if (value === null || value === undefined) continue;
    settings[key] = value;
  }

  if (Array.isArray(settings.serverMessages)) {
    settings.serverMessages = Array.from(new Set([...settings.serverMessages, ...REQUIRED_SERVER_MESSAGES]));
  }
  return settings;
}

// The transcriber that has always been the platform default: Soniox's
// stt-rt-v5 auto-detects the language, so it works for an agent in any of
// the dashboard's languages.
const FALLBACK_TRANSCRIBER = { provider: "soniox", model: "stt-rt-v5" };

// The template's transcriber, unless it is pinned to a language other than
// the agent's — a Danish-only transcriber would turn every English caller
// into gibberish. An unpinned (auto-detecting) one is used as-is.
function resolveTranscriberConfig(
  template: VapiTemplateAssistant | null,
  language: string | null | undefined
): Record<string, unknown> {
  const transcriber = template?.transcriber;
  if (!transcriber || typeof transcriber.provider !== "string") return FALLBACK_TRANSCRIBER;

  const pinned = typeof transcriber.language === "string" ? transcriber.language.toLowerCase() : null;
  const agentLanguage = (language ?? TEMPLATE_LANGUAGE).toLowerCase();
  if (pinned && pinned !== "multi" && !pinned.startsWith(agentLanguage)) return FALLBACK_TRANSCRIBER;

  return transcriber;
}

// The template's endpointing plan, with the platform's email pause added to
// whatever custom rules it already has.
function resolveStartSpeakingPlan(template: VapiTemplateAssistant | null): Record<string, unknown> {
  const plan = template?.startSpeakingPlan ?? {};
  const rules = Array.isArray(plan.customEndpointingRules) ? plan.customEndpointingRules : [];
  const hasEmailRule = rules.some(
    (rule) => (rule as Record<string, unknown> | null)?.regex === EMAIL_PAUSE_RULE.regex
  );
  return { ...plan, customEndpointingRules: hasEmailRule ? rules : [...rules, EMAIL_PAUSE_RULE] };
}

// Vapi caps an assistant's name at 40 characters and refuses the whole
// create/update over a longer one.
const MAX_ASSISTANT_NAME_LENGTH = 40;

function assistantName(name: string): string {
  const trimmed = name.trim() || "AI Booking agent";
  return trimmed.length > MAX_ASSISTANT_NAME_LENGTH ? trimmed.slice(0, MAX_ASSISTANT_NAME_LENGTH).trimEnd() : trimmed;
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
            customer_name: { type: "string", description: "Kundens fulde navn, som kunden selv har oplyst det." },
            customer_email: {
              type: "string",
              // Read back and confirmed, because an address heard wrong is
              // the one booking failure the caller can fix on the spot —
              // and the one that otherwise ends the call with nothing.
              description:
                "Kundens e-mailadresse, som bekræftelsen sendes til. Læs adressen op for kunden og få den bekræftet, før du booker. Skriv den som en e-mailadresse med @ og punktum, fx navn@firma.dk — ikke som den udtales (\"snabel-a\").",
            },
            // Enforced server-side (checkBookingDetails): a booking without
            // it is refused and the agent is told to read the address back.
            email_confirmed: {
              type: "boolean",
              description:
                "true, når du har læst e-mailadressen op for kunden og kunden har sagt, at den er korrekt. Bookingen afvises ellers.",
            },
          },
          required: ["start_time", "customer_name", "customer_email", "email_confirmed"],
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

// Vapi's built-in hang-up tool, on every assistant: when the customer says
// goodbye, the agent says goodbye back and calls it (see END_CALL_DIRECTIVE
// in lib/i18n/agent-content.ts). The function is named explicitly so the
// prompt and the tool always agree on what to call. An empty `messages`
// keeps withSpokenToolMessages from putting "Lige et øjeblik." in front of
// the hang-up.
export function buildEndCallTool() {
  return {
    type: "endCall",
    messages: [],
    function: {
      name: "endCall",
      description:
        "Afslut opkaldet. Brug det, når kunden har sagt farvel eller beder om at afslutte samtalen — efter du har sagt en kort afskedshilsen.",
      parameters: { type: "object", properties: {} },
    },
  };
}

// Vapi speaks a filler the instant a tool fires, before the model has said
// anything — and a tool that carries no `messages` of its own gets Vapi's
// built-in ones, which are English whatever language the agent is speaking.
// That is where "Hold on a sec." came from in the middle of a Danish call.
//
// Attached here, to every tool in the payload, rather than in each tool
// builder: booking tools and Shopify tools are assembled in different modules
// (lib/vapi/assistants.ts and lib/shopify/tool-definitions.ts), and a filler
// in the wrong language is exactly the kind of thing that gets forgotten when
// the next tool is added somewhere else. A builder that sets its own
// `messages` keeps them.
function withSpokenToolMessages(tools: unknown[], language: string | null | undefined): unknown[] {
  return tools.map((tool) => {
    const record = (tool ?? {}) as Record<string, unknown>;
    if (Array.isArray(record.messages)) return tool;

    return {
      ...record,
      messages: [
        { type: "request-start", content: toolWaitText(language) },
        { type: "request-failed", content: toolFailedText(language) },
      ],
    };
  });
}

// Once the agent has asked for an email address, it waits for a full second
// of silence before answering. People dictate addresses in bursts ("anna …
// punktum … hansen"), and the default endpointing jumps in at the first
// pause — the agent then reads back half an address. The rule only matches
// right after the agent's own question, so every other turn keeps its normal
// snappy timing. Matched against the assistant's last message; written with
// explicit case alternatives rather than regexOptions to keep the payload to
// the fields Vapi documents for every rule type.
export const EMAIL_PAUSE_RULE = {
  type: "assistant",
  regex: "[Mm]ail|[Cc]orreo|[Cc]ourriel",
  timeoutSeconds: 1,
} as const;

// If Vapi ever rejects the endpointing plan, the prompt and tools must still
// reach the assistant (same reasoning as isVoiceRejection below).
function isStartSpeakingPlanRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /startSpeakingPlan|customEndpointingRules/i.test(message);
}

// Every agent gets an assistant of its own, built as a copy of whichever
// male/female template the customer picked (see VapiAssistantParams
// .voiceGender) — voice, model engine, transcriber and every other setting
// the admin tuned on it — with the agent's own name, prompt, greeting, tools
// and webhook on top. Read in a single fetch.
// Booking tools are attached only for a widget whose calendar is connected
// and whose booking_enabled gate is on (see lib/vapi/sync.ts).
async function buildAssistantBody(
  params: VapiAssistantParams,
  includeBookingTools: boolean = false,
  extraTools: unknown[] = []
) {
  const gender = params.voiceGender ?? DEFAULT_VOICE_GENDER;
  const template = await resolveTemplate(gender);

  // An agent with no booking tools is told so, in its own language. The
  // customer's prompt describes a receptionist who takes appointments; only
  // the tool list knows whether it can — and without this the agent invents
  // the booking rather than admitting it cannot make one. See
  // NO_BOOKING_DIRECTIVE in lib/i18n/agent-content.ts.
  //
  // An agent that can book gets the platform's booking flow instead (fast
  // offer, email read back and confirmed, explicit yes before booking) — see
  // BOOKING_FLOW_DIRECTIVE.
  //
  // Every agent is also told to hang up once the customer says goodbye — see
  // buildEndCallTool.
  const systemPrompt = withEndCallDirective(
    includeBookingTools
      ? withBookingFlowDirective(params.systemPrompt, params.language)
      : withNoBookingDirective(params.systemPrompt, params.language),
    params.language
  );

  const model: Record<string, unknown> = {
    ...resolveModelConfig(template, gender),
    messages: [{ role: "system", content: systemPrompt }],
  };

  // Sent as an empty list when nothing is enabled, not omitted — a PATCH that
  // leaves the key out would let tools linger on an assistant whose booking
  // (or webshop) was switched back off.
  //
  // `extraTools` is how the Shopify integration adds its own tools without
  // this module having to know anything about webshops; lib/vapi/sync.ts
  // decides which ones a given widget gets.
  model.tools = withSpokenToolMessages(
    [...(includeBookingTools ? buildBookingTools() : []), ...extraTools, buildEndCallTool()],
    params.language
  );

  return {
    // The template first, so every per-agent field below wins over it.
    ...cloneTemplateSettings(template, params.language),
    name: assistantName(params.name),
    firstMessage: params.firstMessage,
    model,
    // `languageHints` was removed live from a production 400: "transcriber
    // .property languageHints should not exist" — Vapi's current API
    // rejects it for the soniox/stt-rt-v5 transcriber, even though it's
    // documented for other providers. Soniox's stt-rt-v5 auto-detects
    // language, so no replacement field is needed here.
    transcriber: resolveTranscriberConfig(template, params.language),
    voice: resolveVoiceConfig(template, gender),
    // Always sent (not only with booking tools), so a PATCH never leaves a
    // stale plan behind — the rule only ever lengthens the pause after the
    // agent asked for an email.
    startSpeakingPlan: resolveStartSpeakingPlan(template),
    // Which agent and which template this assistant is, readable straight
    // from Vapi's dashboard — every agent has an assistant of its own, and
    // this is how one is told apart from another (and from the template it
    // was copied from) without opening our database.
    metadata: {
      platform: "aibooking",
      voiceGender: gender,
      ...(template?.id ? { voiceTemplateAssistantId: template.id } : {}),
      ...(params.widgetId ? { widgetId: params.widgetId } : {}),
    },
    ...(typeof params.silenceTimeoutSeconds === "number"
      ? { silenceTimeoutSeconds: params.silenceTimeoutSeconds }
      : {}),
    ...(typeof params.maxDurationSeconds === "number" ? { maxDurationSeconds: params.maxDurationSeconds } : {}),
    ...webhookConfig(),
  };
}

// A raw assistant as Vapi's list/get endpoints return it — used only by the
// admin "Wapi Agents" catalog (lib/vapi/agent-sync.ts), never by the
// call-answering path, which only ever needs the id (see
// VapiAssistantParams above). Every field is read defensively since Vapi's
// response shape for a hand-built assistant (created directly in their
// dashboard, not by createVapiAssistant) can omit any of them.
export interface VapiAssistantSummary {
  id: string;
  name: string | null;
  voiceProvider: string | null;
  voiceId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  language: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function toAssistantSummary(raw: Record<string, unknown>): VapiAssistantSummary | null {
  const id = raw.id;
  if (typeof id !== "string") return null;

  const voice = (raw.voice ?? {}) as Record<string, unknown>;
  const model = (raw.model ?? {}) as Record<string, unknown>;
  const transcriber = (raw.transcriber ?? {}) as Record<string, unknown>;

  return {
    id,
    name: typeof raw.name === "string" ? raw.name : null,
    voiceProvider: typeof voice.provider === "string" ? voice.provider : null,
    voiceId: typeof voice.voiceId === "string" ? voice.voiceId : null,
    modelProvider: typeof model.provider === "string" ? model.provider : null,
    modelName: typeof model.model === "string" ? model.model : null,
    language: typeof transcriber.language === "string" ? transcriber.language : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

// GET /assistant — every assistant in the platform's Vapi account. Backs the
// admin "Wapi Agent" selector/sync (see lib/vapi/agent-sync.ts) — Vapi has no
// separate "list templates vs. customer assistants" endpoint, so this is
// every assistant the account owns, voice templates and per-widget
// assistants alike.
export async function listVapiAssistants(): Promise<VapiAssistantSummary[]> {
  const response = await vapiFetch("/assistant", { method: "GET" });
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const summaries: VapiAssistantSummary[] = [];
  for (const row of data) {
    const summary = toAssistantSummary((row ?? {}) as Record<string, unknown>);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

// GET /assistant/{id} — a single assistant's current config, for the "View"
// / per-row "Refresh" action on the admin Wapi Agents page and for a manually
// typed agent id the sync hasn't seen yet.
export async function getVapiAssistantDetails(assistantId: string): Promise<VapiAssistantSummary | null> {
  const response = await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, { method: "GET" });
  const data = (await response.json()) as Record<string, unknown>;
  return toAssistantSummary(data);
}

// A template is cloned field by field (cloneTemplateSettings), and Vapi's GET
// can return fields its own POST/PATCH then refuse — "property x should not
// exist", or "transcriber.property languageHints should not exist". One such
// field must not stop the agent from being created or synced: the named
// fields are dropped and the write retried, loudly, so the list above can be
// extended.
const REJECTED_PROPERTY = /(?:([\w.]+)\.)?property (\w+) should not exist/g;
const MAX_REJECTED_PROPERTY_RETRIES = 3;

function rejectedPropertyPaths(err: unknown): string[][] {
  const message = err instanceof Error ? err.message : String(err);
  return Array.from(message.matchAll(REJECTED_PROPERTY), (match) => [
    ...(match[1] ? match[1].split(".") : []),
    match[2]!,
  ]);
}

// Returns null when none of the paths is actually in the body — retrying an
// unchanged body would only fail the same way again.
function withoutPaths(body: Record<string, unknown>, paths: string[][]): Record<string, unknown> | null {
  const copy = structuredClone(body);
  let removed = false;
  for (const path of paths) {
    let parent: unknown = copy;
    for (const key of path.slice(0, -1)) {
      parent = parent && typeof parent === "object" ? (parent as Record<string, unknown>)[key] : undefined;
    }
    const last = path[path.length - 1]!;
    if (parent && typeof parent === "object" && last in (parent as Record<string, unknown>)) {
      delete (parent as Record<string, unknown>)[last];
      removed = true;
    }
  }
  return removed ? copy : null;
}

async function writeAssistant(path: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<Response> {
  let current = body;
  for (let attempt = 0; ; attempt++) {
    try {
      return await vapiFetch(path, { method, body: JSON.stringify(current) });
    } catch (err) {
      const stripped = attempt < MAX_REJECTED_PROPERTY_RETRIES ? withoutPaths(current, rejectedPropertyPaths(err)) : null;
      if (!stripped) throw err;
      console.error(`[vapi] ${method} ${path}: Vapi refused a field cloned from the voice template. Retrying without it.`, err);
      current = stripped;
    }
  }
}

export async function createVapiAssistant(
  params: VapiAssistantParams,
  includeBookingTools = false,
  extraTools: unknown[] = []
): Promise<{ id: string }> {
  const body = await buildAssistantBody(params, includeBookingTools, extraTools);
  let response: Response;
  try {
    response = await writeAssistant("/assistant", "POST", body);
  } catch (err) {
    if (!isStartSpeakingPlanRejection(err)) throw err;
    const { startSpeakingPlan: rejectedPlan, ...withoutPlan } = body;
    console.error(
      `[vapi] New assistant: startSpeakingPlan rejected (${JSON.stringify(rejectedPlan)}). Retrying without it.`,
      err
    );
    response = await writeAssistant("/assistant", "POST", withoutPlan);
  }
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

// DELETE /assistant/{id}. Only ever called on an assistant this request just
// created for an agent that then failed to save — cleaning up so a failed
// "Create agent" never leaves an orphaned assistant behind in Vapi. Never
// used on an agent that exists: agents are paused, not deleted, and keep
// their assistant.
export async function deleteVapiAssistant(assistantId: string): Promise<void> {
  await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, { method: "DELETE" });
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
    await writeAssistant(path, "PATCH", body);
  } catch (err) {
    if (isStartSpeakingPlanRejection(err)) {
      const { startSpeakingPlan: rejectedPlan, ...withoutPlan } = body;
      console.error(
        `[vapi] Assistant ${assistantId}: startSpeakingPlan rejected (${JSON.stringify(rejectedPlan)}). ` +
          "Retrying without it so the prompt, knowledge base and tools still sync.",
        err
      );
      await writeAssistant(path, "PATCH", withoutPlan);
      return;
    }
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
    await writeAssistant(path, "PATCH", withoutVoice);
  }
}
