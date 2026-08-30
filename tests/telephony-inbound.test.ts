import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";

// The phone_numbers rows each test wants resolveTwilioDirectNumber to see.
let phoneNumberRows: Array<Record<string, unknown>> = [];
let lastQuery: { candidates: string[]; purchaseStatus: string } | null = null;

// Minimal stand-in for the one supabase query chain under test here
// (.from().select().in().eq().order().limit()) — the real client is a
// network call, and what these tests care about is which rows the lookup
// asks for and what it does with the answer.
vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: (_column: string, candidates: string[]) => ({
          eq: (_statusColumn: string, purchaseStatus: string) => {
            lastQuery = { candidates, purchaseStatus };
            return {
              order: () => ({
                limit: () => ({ data: phoneNumberRows.slice(0, 1) }),
              }),
            };
          },
        }),
      }),
    }),
  }),
}));

const getOrCreateSubaccount = vi.fn(async (customerId: string) => ({
  accountSid: `AC-subaccount-${customerId}`,
  authToken: `subaccount-token-${customerId}`,
}));

vi.mock("@/lib/twilio", () => ({
  getOrCreateSubaccount: (customerId: string) => getOrCreateSubaccount(customerId),
}));

const { resolveTwilioDirectNumber, resolveTwilioCallCredentials } = await import("@/lib/telephony/resolve");
const { twilioWebhookUrls, assertTwilioWebhookBaseUrlConfigured } = await import("@/lib/telephony/urls");
const { validateTwilioSignature } = await import("@/lib/twilio/signature");

function platformRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pn-1",
    customer_id: "cust-1",
    widget_id: "widget-1",
    source: "platform_twilio",
    twilio_account_sid: null,
    twilio_auth_token: null,
    ...overrides,
  };
}

function byoRow(overrides: Record<string, unknown> = {}) {
  return platformRow({
    source: "byo_twilio",
    twilio_account_sid: "AC-customer-own",
    twilio_auth_token: "customer-own-token",
    ...overrides,
  });
}

beforeEach(() => {
  phoneNumberRows = [];
  lastQuery = null;
  getOrCreateSubaccount.mockClear();
});

describe("resolveTwilioDirectNumber", () => {
  it("only ever resolves an active number", async () => {
    phoneNumberRows = [platformRow()];
    await resolveTwilioDirectNumber("+4512345678");
    expect(lastQuery?.purchaseStatus).toBe("active");
  });

  it("looks the number up as sent and in normalized form", async () => {
    phoneNumberRows = [platformRow()];
    await resolveTwilioDirectNumber("+45 12 34 56 78");
    expect(lastQuery?.candidates).toEqual(["+45 12 34 56 78", "+4512345678"]);
  });

  it("does not query at all for an empty number", async () => {
    expect(await resolveTwilioDirectNumber("  ")).toBeNull();
    expect(lastQuery).toBeNull();
  });

  it("returns null for a number nobody owns", async () => {
    expect(await resolveTwilioDirectNumber("+4599999999")).toBeNull();
  });

  it("validates a BYO number against the customer's own credentials", async () => {
    phoneNumberRows = [byoRow()];
    const context = await resolveTwilioDirectNumber("+4512345678");
    expect(context?.credentials.authToken).toBe("customer-own-token");
    expect(getOrCreateSubaccount).not.toHaveBeenCalled();
  });

  it("validates a platform number against the customer's subaccount", async () => {
    phoneNumberRows = [platformRow()];
    const context = await resolveTwilioDirectNumber("+4512345678");
    expect(context?.credentials.authToken).toBe("subaccount-token-cust-1");
  });

  it("falls back to the subaccount for a BYO row with no stored credentials", async () => {
    phoneNumberRows = [byoRow({ twilio_auth_token: null })];
    const context = await resolveTwilioDirectNumber("+4512345678");
    expect(context?.credentials.authToken).toBe("subaccount-token-cust-1");
  });
});

describe("resolveTwilioCallCredentials", () => {
  // The status webhook's regression: a BYO call's callback is signed with
  // the customer's own token, so resolving by customer alone (the
  // subaccount) rejected every one of them as an invalid signature and left
  // the usage session open — i.e. unbilled.
  it("uses the BYO number's own token rather than the subaccount", async () => {
    phoneNumberRows = [byoRow()];
    const credentials = await resolveTwilioCallCredentials({
      customerId: "cust-1",
      candidateNumbers: [undefined, "+4512345678"],
    });
    expect(credentials.authToken).toBe("customer-own-token");
  });

  it("falls back to the subaccount when no candidate number resolves", async () => {
    const credentials = await resolveTwilioCallCredentials({
      customerId: "cust-1",
      candidateNumbers: [null, "+4599999999"],
    });
    expect(credentials.authToken).toBe("subaccount-token-cust-1");
  });

  it("ignores a number belonging to a different customer", async () => {
    phoneNumberRows = [byoRow({ customer_id: "cust-2" })];
    const credentials = await resolveTwilioCallCredentials({
      customerId: "cust-1",
      candidateNumbers: ["+4512345678"],
    });
    expect(credentials.authToken).toBe("subaccount-token-cust-1");
  });
});

describe("twilioWebhookUrls", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("builds the same URL whether or not the base has a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    const clean = twilioWebhookUrls();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test/";
    expect(twilioWebhookUrls()).toEqual(clean);
    expect(clean.inbound).toBe("https://app.test/api/telephony/twilio/voice/inbound");
  });

  // A "//api/…" URL would be registered with Twilio and then signed by
  // Twilio verbatim — but every webhook recomputes the HMAC from this same
  // helper, so the two only agree while normalization is applied on both
  // sides.
  it("produces a URL a Twilio-signed request still validates against", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test/";
    const authToken = "auth-token";
    const formParams = { To: "+4512345678", CallSid: "CA1" };

    const url = twilioWebhookUrls().inbound;
    let data = url;
    for (const key of Object.keys(formParams).sort()) data += key + formParams[key as keyof typeof formParams];
    const signature = createHmac("sha1", authToken).update(data, "utf8").digest("base64");

    expect(validateTwilioSignature({ url, formParams, signatureHeader: signature, authToken })).toBe(true);
  });
});

describe("assertTwilioWebhookBaseUrlConfigured", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("accepts a public https base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test/";
    expect(() => assertTwilioWebhookBaseUrlConfigured()).not.toThrow();
  });

  it("rejects an unset base URL rather than registering the localhost fallback", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(() => assertTwilioWebhookBaseUrlConfigured()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects a localhost base URL Twilio could never reach", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(() => assertTwilioWebhookBaseUrlConfigured()).toThrow(/offentligt tilgængelig/);
  });

  it("rejects a plain-http public base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://app.test";
    expect(() => assertTwilioWebhookBaseUrlConfigured()).toThrow(/offentligt tilgængelig/);
  });
});
