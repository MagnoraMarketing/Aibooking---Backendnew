import "server-only";
import Anthropic from "@anthropic-ai/sdk";
// The SDK exports its error classes as values on the default export, but the
// TYPE only from this subpath — the annotations below need both.
import { APIError } from "@anthropic-ai/sdk/error";
import { requireCredentialEnv } from "@/lib/security/env";
import { ApiError } from "@/types/errors";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMProvider,
  LLMSummarizeParams,
  LLMSummarizeResult,
} from "./types";

let client: Anthropic | null = null;

// Exported so lib/conversation/calendar-tools.ts can reuse the same
// singleton for its tool-use loop — that path talks to the Anthropic SDK
// directly (tool_use isn't part of the generic LLMProvider interface, and
// Anthropic is the only provider that needs it) rather than going through
// generateReply below.
export function getAnthropicClient(): Anthropic {
  if (client) return client;
  // requireCredentialEnv rather than a bare process.env read: a plain Error
  // here reaches the browser as "Something went wrong" (errorResponse masks
  // non-ApiError throws), which is exactly the unhelpful failure the "Generér
  // prompt" button showed when the key was missing. This says what to fix,
  // and also catches a key pasted into Vercel with line breaks in it.
  const apiKey = requireCredentialEnv(
    "ANTHROPIC_API_KEY",
    "AI-funktionerne er ikke konfigureret endnu (mangler ANTHROPIC_API_KEY i miljøvariablerne på Vercel)."
  );
  client = new Anthropic({ apiKey });
  return client;
}

// Anthropic's SDK throws its own Anthropic.APIError, which — like a plain
// Error — isn't an ApiError, so lib/security/http.ts's errorResponse masks
// it as an opaque "Something went wrong". That's exactly what Prompt Lab's
// "Generér prompt" showed while the real answer sat in the Vercel logs:
// a 400 from Anthropic saying the account's credit balance was too low.
// Nobody looking at the dashboard could have known that, so translate the
// failures an operator can actually act on into messages that say so.
function anthropicErrorMessage(err: APIError): string {
  // The SDK parks the parsed response body on .error, shaped
  // { type: "error", error: { type, message } }.
  const body: unknown = (err as { error?: unknown }).error;
  const inner: unknown = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const message = inner && typeof inner === "object" ? (inner as { message?: unknown }).message : undefined;
  return typeof message === "string" && message ? message : err.message;
}

// Exported for tests — the mapping is the whole point of the wrapper.
export function translateAnthropicError(err: APIError): ApiError {
  const detail = anthropicErrorMessage(err);

  // Anthropic reports an empty account balance as a 400, not a 402, so it
  // can't be told apart from a malformed request by status alone.
  if (/credit balance is too low/i.test(detail)) {
    return ApiError.internal(
      "AI-kontoen (Anthropic) har ikke flere credits, så AI'en kan ikke svare lige nu. Fyld op under Plans & Billing i Anthropic Console, så virker det igen med det samme."
    );
  }

  if (err.status === 401 || err.status === 403) {
    return ApiError.internal(
      `Anthropic afviste vores API-nøgle (${detail}). Tjek ANTHROPIC_API_KEY i miljøvariablerne på Vercel.`
    );
  }

  if (err.status === 404) {
    return ApiError.internal(
      `Anthropic kender ikke den valgte model (${detail}). Ret modelnavnet under Admin → Indstillinger.`
    );
  }

  if (err.status === 429) {
    return ApiError.tooManyRequests("Anthropic er ramt af for mange forespørgsler lige nu. Prøv igen om et øjeblik.");
  }

  if (err.status && err.status >= 500) {
    return ApiError.internal("Anthropic er midlertidigt utilgængelig. Prøv igen om et øjeblik.");
  }

  return ApiError.badRequest(`Anthropic-fejl: ${detail}`);
}

async function callAnthropic<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof APIError) throw translateAnthropicError(err);
    throw err;
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async generateReply(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const response = await callAnthropic(() =>
      getAnthropicClient().messages.create({
        model: params.model,
        system: params.systemPrompt,
        max_tokens: params.maxTokens,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      })
    );

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

    const response = await callAnthropic(() =>
      getAnthropicClient().messages.create({
        model: params.model,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      })
    );

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
