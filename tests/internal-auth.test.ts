import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireInternalSecret } from "@/lib/security/internal-auth";
import { ApiError } from "@/types/errors";

function requestWithSecret(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set("x-internal-secret", secret);
  return new Request("http://localhost/api/internal/conversation-relay/turn", { headers });
}

describe("requireInternalSecret", () => {
  const original = process.env.CONVERSATION_RELAY_INTERNAL_SECRET;

  beforeEach(() => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = "correct-secret";
  });

  afterEach(() => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = original;
  });

  it("passes silently when the header matches the configured secret", () => {
    expect(() => requireInternalSecret(requestWithSecret("correct-secret"))).not.toThrow();
  });

  it("throws unauthorized when the header is missing", () => {
    expect(() => requireInternalSecret(requestWithSecret(null))).toThrow(ApiError);
  });

  it("throws unauthorized when the header doesn't match", () => {
    try {
      requireInternalSecret(requestWithSecret("wrong-secret"));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
    }
  });

  it("throws unauthorized (not a crash) when header and secret differ in length", () => {
    expect(() => requireInternalSecret(requestWithSecret("short"))).toThrow(ApiError);
  });

  it("throws internal error when CONVERSATION_RELAY_INTERNAL_SECRET is unset", () => {
    delete process.env.CONVERSATION_RELAY_INTERNAL_SECRET;
    try {
      requireInternalSecret(requestWithSecret("anything"));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });
});
