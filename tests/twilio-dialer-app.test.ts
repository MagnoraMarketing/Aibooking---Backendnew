import { describe, it, expect, vi, beforeEach } from "vitest";

interface DialerRow {
  dialer_api_key_sid: string | null;
  dialer_api_key_secret: string | null;
  dialer_twiml_app_sid: string | null;
}

let row: DialerRow;
const twilioFetchMock = vi.fn();

vi.mock("@/lib/twilio/client", () => ({
  twilioFetch: (...args: unknown[]) => twilioFetchMock(...args),
}));

vi.mock("@/lib/twilio/subaccounts", () => ({
  getOrCreateSubaccount: async () => ({ accountSid: "AC_sub", authToken: "sub_token" }),
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
      update: (values: DialerRow) => ({
        eq: async () => {
          row = { ...row, ...values };
          return { error: null };
        },
      }),
    }),
  }),
}));

import { getOrCreateDialerApp } from "@/lib/twilio/dialer";

function response(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Answers the provisioning POSTs; `existing` decides what the re-check of an
// already-cached Key/Application sees.
function mockTwilio(existing: { key: number; app: number }) {
  twilioFetchMock.mockImplementation(async (path: string) => {
    if (path === "/Keys.json") return response(201, { sid: "SK_new", secret: "secret_new" });
    if (path === "/Applications.json") return response(201, { sid: "AP_new" });
    if (path.startsWith("/Keys/")) return response(existing.key);
    if (path.startsWith("/Applications/")) return response(existing.app);
    throw new Error(`unexpected path ${path}`);
  });
}

describe("getOrCreateDialerApp", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.aibooking.dk/";
    twilioFetchMock.mockReset();
    row = { dialer_api_key_sid: null, dialer_api_key_secret: null, dialer_twiml_app_sid: null };
  });

  it("provisions a Key and an Application under the subaccount on first use", async () => {
    mockTwilio({ key: 200, app: 200 });

    const app = await getOrCreateDialerApp("cust-1");

    expect(app).toMatchObject({ accountSid: "AC_sub", apiKeySid: "SK_new", twimlAppSid: "AP_new" });
    const appCall = twilioFetchMock.mock.calls.find(([path]) => path === "/Applications.json")!;
    expect((appCall[2].body as URLSearchParams).get("VoiceUrl")).toBe(
      "https://app.aibooking.dk/api/telephony/twilio/voice/dialer-start?customerId=cust-1"
    );
    expect(row.dialer_twiml_app_sid).toBe("AP_new");
  });

  // The cached Application kept whatever Voice URL the first use saw — the
  // reason calls rang out after the app URL changed.
  it("re-asserts the current Voice URL on a cached Application", async () => {
    row = { dialer_api_key_sid: "SK_old", dialer_api_key_secret: "secret_old", dialer_twiml_app_sid: "AP_old" };
    mockTwilio({ key: 200, app: 200 });

    const app = await getOrCreateDialerApp("cust-1");

    expect(app).toMatchObject({ apiKeySid: "SK_old", twimlAppSid: "AP_old" });
    const update = twilioFetchMock.mock.calls.find(([path]) => path === "/Applications/AP_old.json")!;
    expect(update[2].method).toBe("POST");
    expect((update[2].body as URLSearchParams).get("VoiceUrl")).toBe(
      "https://app.aibooking.dk/api/telephony/twilio/voice/dialer-start?customerId=cust-1"
    );
    expect(twilioFetchMock.mock.calls.some(([path]) => path === "/Keys.json")).toBe(false);
  });

  it("provisions again when the cached Key or Application was deleted on Twilio", async () => {
    row = { dialer_api_key_sid: "SK_old", dialer_api_key_secret: "secret_old", dialer_twiml_app_sid: "AP_old" };
    mockTwilio({ key: 404, app: 200 });

    const app = await getOrCreateDialerApp("cust-1");

    expect(app).toMatchObject({ apiKeySid: "SK_new", apiKeySecret: "secret_new", twimlAppSid: "AP_new" });
    expect(row).toEqual({ dialer_api_key_sid: "SK_new", dialer_api_key_secret: "secret_new", dialer_twiml_app_sid: "AP_new" });
  });

  it("refuses to provision against a non-public app URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    mockTwilio({ key: 200, app: 200 });

    await expect(getOrCreateDialerApp("cust-1")).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
    expect(twilioFetchMock).not.toHaveBeenCalled();
  });
});
