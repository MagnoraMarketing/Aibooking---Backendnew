import "server-only";
import { AnthropicProvider } from "./anthropic-provider";
import type { LLMProvider } from "./types";

const anthropicProvider = new AnthropicProvider();

// 'twilio_relay' (the ConversationRelay voice widget engine, see
// 0024_twilio_conversation_relay.sql) reuses the exact same AnthropicProvider
// instance as 'anthropic' (the phone/text-widget engine) — both are Claude
// reasoning, just delivered over a different voice transport. Sharing the
// instance also means llmProvider.name === "anthropic" downstream (see
// calendar-tools.ts) is true for both, so Cal.com tool-use booking works the
// same way on either engine with no extra branching.
const providers: Record<string, LLMProvider> = {
  anthropic: anthropicProvider,
  twilio_relay: anthropicProvider,
};

// Resolves a provider row's `provider` column to an LLMProvider
// implementation. Adding a new vendor later is a matter of registering it
// here — no changes needed anywhere else in the codebase.
export function resolveLLMProvider(providerName: string): LLMProvider {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown LLM provider: ${providerName}`);
  return provider;
}
