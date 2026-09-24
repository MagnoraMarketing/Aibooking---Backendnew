import "server-only";

// OpenAI retired the beta Realtime endpoints: POST /v1/realtime/sessions now
// answers 404 "Invalid URL", which broke every "realtime" voice widget with
// "Kunne ikke forbinde (Something went wrong)". The GA API mints the browser's
// ephemeral key via POST /v1/realtime/client_secrets, with the session config
// nested under `session` (type "realtime", voice under audio.output).
const OPENAI_REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_VOICE = "alloy";
const DEFAULT_MODEL = "gpt-realtime";
// Lets the widget show what the caller said (conversation.item.input_audio_transcription.completed).
const INPUT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing required environment variable: OPENAI_API_KEY");
  return apiKey;
}

/**
 * The beta "…-realtime-preview" models were retired together with the beta
 * endpoints. Agents saved before the switch still carry those names, so they
 * are mapped to their GA successor instead of failing the call.
 */
export function toGaRealtimeModel(model: string | null | undefined): string {
  const name = (model ?? "").trim();
  if (!name) return DEFAULT_MODEL;
  if (/mini-realtime-preview/.test(name)) return "gpt-realtime-mini";
  if (/realtime-preview/.test(name)) return DEFAULT_MODEL;
  return name;
}

export interface RealtimeClientSecret {
  clientSecret: string;
  expiresAt: number | null;
  model: string;
  voice: string;
}

// Mints a short-lived, scoped client secret the browser can use to open a
// WebRTC connection directly to OpenAI's Realtime API. This is the only
// server-side call involved — once the browser has the client secret, audio
// flows peer-to-peer to OpenAI, never through our backend. OPENAI_API_KEY
// itself never leaves the server (same invariant as the Anthropic/ElevenLabs
// keys — see public/widget.js's header comment).
export async function createRealtimeClientSecret(params: {
  model: string;
  instructions: string;
  voice?: string;
}): Promise<RealtimeClientSecret> {
  const voice = params.voice ?? DEFAULT_VOICE;
  const model = toGaRealtimeModel(params.model);

  const response = await fetch(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions: params.instructions,
        audio: {
          input: { transcription: { model: INPUT_TRANSCRIPTION_MODEL } },
          output: { voice },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to create OpenAI realtime session: ${response.status} ${errorBody}`);
  }

  // GA shape: { value, expires_at, session }. The beta nested it under
  // client_secret – still accepted so a partial rollout can't break the widget.
  const data = (await response.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  };
  const clientSecret = data.value ?? data.client_secret?.value;
  if (!clientSecret) {
    throw new Error("OpenAI realtime session response did not include a client secret");
  }

  return {
    clientSecret,
    expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? null,
    model,
    voice,
  };
}
