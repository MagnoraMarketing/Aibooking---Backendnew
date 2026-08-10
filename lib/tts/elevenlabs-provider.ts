import "server-only";
import type { TTSProvider, TTSSynthesizeParams, TTSSynthesizeResult } from "./types";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

// Hard safety cap on TTS input length regardless of what the LLM produced —
// belt-and-suspenders cost control on top of the LLM's own max_response_chars.
const MAX_TTS_CHARACTERS = 800;

function getApiKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Missing required environment variable: ELEVENLABS_API_KEY");
  return apiKey;
}

export class ElevenLabsProvider implements TTSProvider {
  readonly name = "elevenlabs";

  async synthesize(params: TTSSynthesizeParams): Promise<TTSSynthesizeResult> {
    const text = params.text.slice(0, MAX_TTS_CHARACTERS);

    const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${params.voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": getApiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: params.modelId ?? "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS request failed (${response.status}): ${errorBody.slice(0, 300)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      audioBase64,
      contentType: "audio/mpeg",
      charactersUsed: text.length,
    };
  }
}
