import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMProvider,
  LLMSummarizeParams,
  LLMSummarizeResult,
} from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
  client = new Anthropic({ apiKey });
  return client;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async generateReply(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const response = await getClient().messages.create({
      model: params.model,
      system: params.systemPrompt,
      max_tokens: params.maxTokens,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async summarize(params: LLMSummarizeParams): Promise<LLMSummarizeResult> {
    const transcript = params.messages
      .map((m) => `${m.role === "user" ? "Bruger" : "Assistent"}: ${m.content}`)
      .join("\n");

    const prompt = params.existingSummary
      ? `Eksisterende resume af samtalen indtil videre:\n${params.existingSummary}\n\nOpdater resumeet med denne nye del af samtalen. Hold det kort (maks 5 sætninger) og bevar kun fakta der er relevante for at fortsætte samtalen (kundens behov, aftaler, navn, kontaktinfo, beslutninger).\n\nNy del af samtalen:\n${transcript}`
      : `Lav et kort resume (maks 5 sætninger) af denne samtale. Bevar kun fakta der er relevante for at fortsætte samtalen (kundens behov, aftaler, navn, kontaktinfo, beslutninger).\n\nSamtale:\n${transcript}`;

    const response = await getClient().messages.create({
      model: params.model,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const summary = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return {
      summary,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
