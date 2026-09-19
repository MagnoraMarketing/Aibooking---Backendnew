import "server-only";
import { AnthropicProvider } from "./anthropic-provider";
import { VapiChatProvider } from "./vapi-provider";
import { FallbackProvider } from "./fallback-provider";
import type { LLMProvider } from "./types";

const anthropicProvider = new AnthropicProvider();
const vapiChatProvider = new VapiChatProvider();

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
  vapi: vapiChatProvider,
};

// Resolves a provider row's `provider` column to an LLMProvider
// implementation. Adding a new vendor later is a matter of registering it
// here — no changes needed anywhere else in the codebase.
export function resolveLLMProvider(providerName: string): LLMProvider {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown LLM provider: ${providerName}`);
  return provider;
}

// Anthropic wrapped so that if it throws (out of credits, key revoked,
// outage — see anthropic-provider.ts's error translation), the call retries
// once against a master-admin-configured Vapi assistant instead of failing
// outright — whatever model that assistant runs on in Vapi's own dashboard.
// Only meaningfully changes behaviour once a Vapi prompt-drafting assistant
// is set under Admin → Indstillinger — until then VapiChatProvider's own
// "not configured" error is swallowed and Anthropic's original error is
// what the caller sees, so this is a no-op by default.
export function resolveLLMProviderWithFallback(providerName: string): LLMProvider {
  const provider = resolveLLMProvider(providerName);
  if (provider === anthropicProvider) {
    return new FallbackProvider(anthropicProvider, vapiChatProvider);
  }
  return provider;
}
