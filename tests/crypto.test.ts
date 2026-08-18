import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";

beforeAll(() => {
  process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("encryptSecret / decryptSecret (Cal.com API key at rest)", () => {
  it("round-trips a secret", () => {
    const plaintext = "cal_live_super_secret_key_12345";
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random iv)", () => {
    const plaintext = "cal_live_same_key";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("throws on tampered ciphertext instead of returning garbage", () => {
    const ciphertext = encryptSecret("cal_live_key");
    const tampered = ciphertext.slice(0, -4) + "abcd";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws a clear error when the encryption key env var is missing", () => {
    const original = process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/CALENDAR_CREDENTIALS_ENCRYPTION_KEY/);
    process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY = original;
  });
});
