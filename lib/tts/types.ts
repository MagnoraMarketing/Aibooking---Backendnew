export interface TTSSynthesizeParams {
  text: string;
  voiceId: string;
  modelId?: string;
}

export interface TTSSynthesizeResult {
  audioBase64: string;
  contentType: string;
  charactersUsed: number;
}

// Abstraction so the platform isn't locked to a single TTS vendor.
// ElevenLabs is the only implementation today (see elevenlabs-provider.ts).
export interface TTSProvider {
  readonly name: string;
  synthesize(params: TTSSynthesizeParams): Promise<TTSSynthesizeResult>;
}
