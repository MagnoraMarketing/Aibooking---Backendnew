import { describe, it, expect, afterEach } from "vitest";
import { twilioWebhookUrls, assertTwilioWebhookBaseUrlConfigured } from "@/lib/telephony/urls";

const saved = {
  app: process.env.NEXT_PUBLIC_APP_URL,
  prod: process.env.VERCEL_PROJECT_PRODUCTION_URL,
};

function setEnv(app: string | undefined, prod: string | undefined) {
  if (app === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = app;
  if (prod === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = prod;
}

describe("Twilio webhook base URL", () => {
  afterEach(() => setEnv(saved.app, saved.prod));

  it("prefers NEXT_PUBLIC_APP_URL", () => {
    setEnv("https://app.aibooking.dk/", "aibooking-backendnew.vercel.app");
    expect(twilioWebhookUrls().dialerStart).toBe("https://app.aibooking.dk/api/telephony/twilio/voice/dialer-start");
  });

  // Production ran with no NEXT_PUBLIC_APP_URL: every Twilio URL was localhost.
  it("falls back to Vercel's stable production domain", () => {
    setEnv(undefined, "aibooking-backendnew.vercel.app");
    expect(twilioWebhookUrls().outboundStart).toBe(
      "https://aibooking-backendnew.vercel.app/api/telephony/twilio/voice/outbound-start"
    );
    expect(() => assertTwilioWebhookBaseUrlConfigured()).not.toThrow();
  });

  it("still refuses when neither is set", () => {
    setEnv(undefined, undefined);
    expect(twilioWebhookUrls().status).toBe("http://localhost:3000/api/telephony/twilio/voice/status");
    expect(() => assertTwilioWebhookBaseUrlConfigured()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
