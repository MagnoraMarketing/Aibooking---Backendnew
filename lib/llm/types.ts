export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMGenerateParams {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  maxTokens: number;
}

export interface LLMGenerateResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMSummarizeParams {
  model: string;
  existingSummary: string | null;
  messages: LLMMessage[];
}

export interface LLMSummarizeResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

// Abstraction so the platform is never locked to a single LLM vendor.
// Anthropic Claude is the only implementation today (see anthropic-provider.ts).
export interface LLMProvider {
  readonly name: string;
  generateReply(params: LLMGenerateParams): Promise<LLMGenerateResult>;
  summarize(params: LLMSummarizeParams): Promise<LLMSummarizeResult>;
}
