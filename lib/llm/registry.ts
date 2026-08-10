import "server-only";
import { AnthropicProvider } from "./anthropic-provider";
import type { LLMProvider } from "./types";

const providers: Record<string, LLMProvider> = {
  anthropic: new AnthropicProvider(),
};

// Resolves a provider row's `provider` column to an LLMProvider
// implementation. Adding a new vendor later is a matter of registering it
// here — no changes needed anywhere else in the codebase.
export function resolveLLMProvider(providerName: string): LLMProvider {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown LLM provider: ${providerName}`);
  return provider;
}
