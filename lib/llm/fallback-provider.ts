import "server-only";
import type { LLMGenerateParams, LLMGenerateResult, LLMProvider, LLMSummarizeParams, LLMSummarizeResult } from "./types";

// Wraps a primary provider with a secondary one to try when the primary
// throws — e.g. Anthropic running out of credits shouldn't block Prompt
// Lab's "Generér prompt" when a fallback (a Vapi assistant, see
// vapi-provider.ts) is configured. secondaryModel overrides params.model for
// the fallback call, since vendors don't share model names — omit it for a
// secondary that resolves its own target itself (VapiChatProvider reads a
// configured assistant id rather than taking a model name).
//
// If the secondary isn't configured either (or fails for its own reason),
// the *primary's* error is what reaches the caller — it names the account
// that's actually meant to be topped up, which is more actionable than the
// fallback's "not configured" message.
export class FallbackProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly primary: LLMProvider,
    private readonly secondary: LLMProvider,
    private readonly secondaryModel?: string
  ) {
    this.name = primary.name;
  }

  private withSecondaryModel<T extends { model: string }>(params: T): T {
    return this.secondaryModel ? { ...params, model: this.secondaryModel } : params;
  }

  async generateReply(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    try {
      return await this.primary.generateReply(params);
    } catch (primaryErr) {
      try {
        return await this.secondary.generateReply(this.withSecondaryModel(params));
      } catch {
        throw primaryErr;
      }
    }
  }

  async summarize(params: LLMSummarizeParams): Promise<LLMSummarizeResult> {
    try {
      return await this.primary.summarize(params);
    } catch (primaryErr) {
      try {
        return await this.secondary.summarize(this.withSecondaryModel(params));
      } catch {
        throw primaryErr;
      }
    }
  }
}
