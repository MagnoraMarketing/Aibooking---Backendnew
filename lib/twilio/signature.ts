import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Twilio's request-signing algorithm (https://www.twilio.com/docs/usage/security#validating-requests):
// sort the POST params by key, concatenate each key immediately followed by
// its value (no separator) onto the exact webhook URL Twilio was
// configured with, HMAC-SHA1 that using the auth token, base64-encode, and
// compare to the X-Twilio-Signature header. `url` must be the literal URL
// registered with Twilio (see lib/twilio/numbers.ts's
// configureDirectVoiceWebhook) — reconstructing it from request headers is
// unreliable behind a proxy, so callers pass the known, fixed value instead.
export function validateTwilioSignature(params: {
  url: string;
  formParams: Record<string, string>;
  signatureHeader: string | null;
  authToken: string;
}): boolean {
  if (!params.signatureHeader) return false;

  const sortedKeys = Object.keys(params.formParams).sort();
  let data = params.url;
  for (const key of sortedKeys) {
    data += key + params.formParams[key];
  }

  const expected = createHmac("sha1", params.authToken).update(data, "utf8").digest("base64");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(params.signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

// Twilio POSTs application/x-www-form-urlencoded — this flattens a parsed
// FormData/URLSearchParams into the plain string map validateTwilioSignature
// expects (a repeated key keeps only its last value, which Twilio's own
// webhook payloads never do in practice).
export function formDataToParams(formData: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });
  return params;
}
