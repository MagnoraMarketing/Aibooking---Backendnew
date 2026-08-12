import "server-only";

const OPENAI_REALTIME_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions";
const DEFAULT_VOICE = "alloy";

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing required environment variable: OPENAI_API_KEY");
  return apiKey;
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

  const response = await fetch(OPENAI_REALTIME_SESSIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      voice,
      instructions: params.instructions,
      modalities: ["audio", "text"],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to create OpenAI realtime session: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as { client_secret?: { value?: string; expires_at?: number } };
  const clientSecret = data.client_secret?.value;
  if (!clientSecret) {
    throw new Error("OpenAI realtime session response did not include a client secret");
  }

  return {
    clientSecret,
    expiresAt: data.client_secret?.expires_at ?? null,
    model: params.model,
    voice,
  };
}
