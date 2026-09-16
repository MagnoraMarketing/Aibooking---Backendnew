import { describe, it, expect, vi, beforeEach } from "vitest";

// An inbound number answers through a Vapi assistant, always. It used to
// depend on the agent's model: an agent on the Anthropic model got its number
// pointed at our own TwiML webhooks instead, which answers a caller with a
// pipeline that has no Vapi assistant behind it at all. These tests pin the
// rule at the two places a number can enter the platform — bought from the
// platform, or brought from the customer's own Twilio account.

const importTwilioPhoneNumber = vi.fn(async () => ({ id: "vapi_num_1", number: "+4571234567" }));
const configureDirectVoiceWebhook = vi.fn(async () => {});
const purchaseTwilioNumber = vi.fn(async () => ({ sid: "PN1", phoneNumber: "+4571234567" }));

vi.mock("@/lib/vapi", () => ({
  importTwilioPhoneNumber: (...args: unknown[]) => importTwilioPhoneNumber(...(args as [])),
}));

vi.mock("@/lib/twilio", () => ({
  getOrCreateSubaccount: async () => ({ accountSid: "AC1", authToken: "token" }),
  purchaseTwilioNumber: (...args: unknown[]) => purchaseTwilioNumber(...(args as [])),
  releaseTwilioNumber: async () => {},
  configureDirectVoiceWebhook: (...args: unknown[]) => configureDirectVoiceWebhook(...(args as [])),
}));

vi.mock("@/lib/telephony/urls", () => ({
  assertTwilioWebhookBaseUrlConfigured: () => {},
  twilioWebhookUrls: () => ({ inbound: "https://example.com/in", status: "https://example.com/status" }),
}));

vi.mock("@/lib/security/audit", () => ({ writeAuditLog: async () => {} }));

// A row's final state is what matters here, so the stub records updates
// rather than pretending to be Postgres.
let phoneRow: Record<string, unknown>;
let widgetRow: Record<string, unknown> | null;
let modelRow: Record<string, unknown> | null;
let settingsRow: Record<string, unknown> | null;
const updates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "phone_numbers") {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: phoneRow, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            Object.assign(phoneRow, patch);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "widgets") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: widgetRow }) }) }) };
      }
      if (table === "llm_models") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: modelRow }) }) }) };
      }
      if (table === "widget_settings") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: settingsRow }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { provisionPurchasedNumber } from "@/lib/phone-numbers/service";

function givenRow(direction: string) {
  phoneRow = {
    id: "row-1",
    customer_id: "cust-1",
    widget_id: "widget-1",
    phone_number: "+4571234567",
    direction,
    purchase_status: "payment_confirmed",
    label: "Indbound frisør",
  };
}

beforeEach(() => {
  importTwilioPhoneNumber.mockClear();
  configureDirectVoiceWebhook.mockClear();
  purchaseTwilioNumber.mockClear();
  updates.length = 0;
  widgetRow = { llm_model_id: "model-1" };
  modelRow = { provider: "vapi" };
  settingsRow = { extra: { vapiAssistantId: "asst_1" } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a purchased inbound number", () => {
  it("is imported into Vapi even when the agent runs on the Anthropic model", async () => {
    givenRow("inbound");
    modelRow = { provider: "anthropic" };

    await provisionPurchasedNumber("row-1");

    expect(importTwilioPhoneNumber).toHaveBeenCalledTimes(1);
    expect(configureDirectVoiceWebhook).not.toHaveBeenCalled();
    expect(phoneRow.purchase_status).toBe("active");
    expect(phoneRow.vapi_phone_number_id).toBe("vapi_num_1");
  });

  // Without an assistant there is nothing to answer the call, so the number
  // must not come up "active" — the customer needs to see why.
  it("fails with a reason the customer can act on when the agent has no assistant", async () => {
    givenRow("inbound");
    settingsRow = { extra: {} };

    await provisionPurchasedNumber("row-1");

    expect(phoneRow.purchase_status).toBe("failed");
    expect(String(phoneRow.failure_reason)).toContain("Vapi-assistent");
    expect(configureDirectVoiceWebhook).not.toHaveBeenCalled();
  });
});

// Outbound is a different question: an older Anthropic agent still places its
// calls through Twilio directly (see the outbound campaign launch route), and
// this change is not the place to move that.
describe("an outbound number", () => {
  it("still uses the direct Twilio pipeline for an Anthropic agent", async () => {
    givenRow("outbound");
    modelRow = { provider: "anthropic" };

    await provisionPurchasedNumber("row-1");

    expect(configureDirectVoiceWebhook).toHaveBeenCalledTimes(1);
    expect(importTwilioPhoneNumber).not.toHaveBeenCalled();
    expect(phoneRow.purchase_status).toBe("active");
  });

  it("goes to Vapi for a Vapi agent, as before", async () => {
    givenRow("outbound");

    await provisionPurchasedNumber("row-1");

    expect(importTwilioPhoneNumber).toHaveBeenCalledTimes(1);
    expect(configureDirectVoiceWebhook).not.toHaveBeenCalled();
  });
});
