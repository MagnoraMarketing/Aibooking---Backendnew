import { describe, it, expect } from "vitest";
import { APIError } from "@anthropic-ai/sdk/error";
import { translateAnthropicError } from "@/lib/llm/anthropic-provider";

// The real body shape Anthropic returns; the SDK parks it on err.error.
function apiError(status: number, message: string, type = "invalid_request_error"): APIError {
  return new APIError(status, { type: "error", error: { type, message } }, undefined, undefined);
}

describe("Anthropic error translation", () => {
  // The failure that made Prompt Lab's "Generér prompt" show nothing but
  // "Something went wrong" while the real cause sat in the Vercel logs.
  it("names an empty Anthropic credit balance instead of masking it", () => {
    const err = translateAnthropicError(
      apiError(400, "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.")
    );
    expect(err.status).toBe(500);
    expect(err.message).toContain("credits");
    expect(err.message).toContain("Plans & Billing");
  });

  it("points at the API key on an auth failure", () => {
    const err = translateAnthropicError(apiError(401, "invalid x-api-key", "authentication_error"));
    expect(err.message).toContain("ANTHROPIC_API_KEY");
  });

  it("points at the model setting on an unknown model", () => {
    const err = translateAnthropicError(apiError(404, "model: nope-1", "not_found_error"));
    expect(err.message).toContain("model");
  });

  it("maps rate limiting to 429, not an opaque 500", () => {
    const err = translateAnthropicError(apiError(429, "rate limit exceeded", "rate_limit_error"));
    expect(err.status).toBe(429);
  });

  it("treats an Anthropic outage as temporary", () => {
    const err = translateAnthropicError(apiError(529, "overloaded", "overloaded_error"));
    expect(err.status).toBe(500);
    expect(err.message).toContain("Prøv igen");
  });

  it("still surfaces the API's own wording for anything unclassified", () => {
    const err = translateAnthropicError(apiError(400, "max_tokens: must be greater than 0"));
    expect(err.status).toBe(400);
    expect(err.message).toContain("max_tokens");
  });
});
