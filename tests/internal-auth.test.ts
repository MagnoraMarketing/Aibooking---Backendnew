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

// The dialer's cron job spent an evening getting 401s from a secret that
// looked identical on both sides: the value pasted into the hosting
// dashboard had picked up a newline, and the comparison is length-sensitive.
describe("a secret that picked up whitespace on the way in", () => {
  const original = process.env.CONVERSATION_RELAY_INTERNAL_SECRET;

  afterEach(() => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = original;
  });

  it("accepts the right secret when the stored copy has a trailing newline", () => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = "correct-secret\n";

    expect(() => requireInternalSecret(requestWithSecret("correct-secret"))).not.toThrow();
  });

  it("accepts the right secret when the header arrives padded", () => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = "correct-secret";

    expect(() => requireInternalSecret(requestWithSecret("  correct-secret  "))).not.toThrow();
  });

  // Ignoring whitespace is not the same as ignoring the secret.
  it("still refuses a secret that is merely similar", () => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = "correct-secret";

    expect(() => requireInternalSecret(requestWithSecret("correct-secre"))).toThrow(ApiError);
    expect(() => requireInternalSecret(requestWithSecret("correct secret"))).toThrow(ApiError);
  });

  it("still refuses when only whitespace is configured", () => {
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET = "   ";

    expect(() => requireInternalSecret(requestWithSecret("   "))).toThrow(ApiError);
  });
});
