import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { validateTwilioSignature } from "@/lib/twilio/signature";

// Independent reference implementation of Twilio's signing algorithm
// (https://www.twilio.com/docs/usage/security#validating-requests), written
// directly here rather than imported, so this test can't pass just because
// it shares a bug with the implementation under test.
function referenceSign(url: string, params: Record<string, string>, authToken: string): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

describe("validateTwilioSignature", () => {
  const url = "https://example.com/api/telephony/twilio/voice/inbound";
  const authToken = "test-auth-token-12345";
  const params = { To: "+4512345678", From: "+4587654321", CallSid: "CA1234567890" };

  it("accepts a correctly computed signature", () => {
    const signature = referenceSign(url, params, authToken);
    expect(validateTwilioSignature({ url, formParams: params, signatureHeader: signature, authToken })).toBe(true);
  });

  it("rejects a signature computed with the wrong auth token", () => {
    const signature = referenceSign(url, params, "a-different-token");
    expect(validateTwilioSignature({ url, formParams: params, signatureHeader: signature, authToken })).toBe(false);
  });

  it("rejects when a param was tampered with after signing", () => {
    const signature = referenceSign(url, params, authToken);
    const tampered = { ...params, CallSid: "CA_attacker_injected" };
    expect(validateTwilioSignature({ url, formParams: tampered, signatureHeader: signature, authToken })).toBe(false);
  });

  it("rejects when signed against a different URL", () => {
    const signature = referenceSign(url, params, authToken);
    const otherUrl = "https://example.com/api/telephony/twilio/voice/turn";
    expect(validateTwilioSignature({ url: otherUrl, formParams: params, signatureHeader: signature, authToken })).toBe(
      false
    );
  });

  it("rejects a missing signature header", () => {
    expect(validateTwilioSignature({ url, formParams: params, signatureHeader: null, authToken })).toBe(false);
  });

  it("is order-independent for the params object's key insertion order", () => {
    const signature = referenceSign(url, params, authToken);
    const reordered = { CallSid: params.CallSid, To: params.To, From: params.From };
    expect(validateTwilioSignature({ url, formParams: reordered, signatureHeader: signature, authToken })).toBe(true);
  });
});
