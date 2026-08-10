import "server-only";
import { ElevenLabsProvider } from "./elevenlabs-provider";
import type { TTSProvider } from "./types";

const providers: Record<string, TTSProvider> = {
  elevenlabs: new ElevenLabsProvider(),
};

export function resolveTTSProvider(providerName: string): TTSProvider {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown TTS provider: ${providerName}`);
  return provider;
}
