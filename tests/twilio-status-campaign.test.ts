import { describe, it, expect, vi, beforeEach } from "vitest";

const tables: Record<string, Record<string, unknown> | null> = {};
const settleMock = vi.fn();
let signatureValid = true;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/usage", () => ({ finalizeUsageSession: vi.fn() }));
vi.mock("@/lib/twilio", () => ({
  validateTwilioSignature: () => signatureValid,
  formDataToParams: (formData: FormData) => Object.fromEntries(formData.entries()),
}));
vi.mock("@/lib/telephony/resolve", () => ({
  resolveTwilioCallCredentials: async () => ({ accountSid: "AC_sub", authToken: "sub_token" }),
}));
vi.mock("@/lib/outbound/settle", () => ({
  settleCampaignContact: (...args: unknown[]) => settleMock(...args),
}));

import { POST } from "@/app/api/telephony/twilio/voice/status/route";

function statusRequest(callStatus: string) {
  const body = new URLSearchParams({ CallSid: "CA123", CallStatus: callStatus, From: "+4570000000", To: "+4512345678" });
  return new Request("https://app.aibooking.dk/api/telephony/twilio/voice/status", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": "sig" },
    body,
  });
}

describe("Twilio status webhook — campaign calls placed through the subaccount", () => {
  beforeEach(() => {
    settleMock.mockReset();
    signatureValid = true;
    for (const key of Object.keys(tables)) delete tables[key];
    tables.outbound_campaign_contacts = { id: "contact-1", campaign_id: "campaign-1" };
    tables.outbound_campaigns = { customer_id: "cust-1" };
  });

  // No answer means outbound-start never ran, so there is no conversation —
  // these callbacks used to be dropped and the contact stayed "calling".
  it("settles an unanswered call that never became a conversation", async () => {
    const res = await POST(statusRequest("no-answer"));

    expect(res.status).toBe(200);
    expect(settleMock).toHaveBeenCalledWith(expect.anything(), "contact-1", {
      answered: false,
      reason: "Twilio: no-answer",
    });
  });

  it("ignores a forged callback", async () => {
    signatureValid = false;
    await POST(statusRequest("busy"));
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("ignores non-terminal statuses", async () => {
    await POST(statusRequest("ringing"));
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("marks an answered call with a conversation as completed", async () => {
    tables.conversations = { id: "conv-1", customer_id: "cust-1" };

    await POST(statusRequest("completed"));

    expect(settleMock).toHaveBeenCalledWith(expect.anything(), "contact-1", { answered: true, reason: "" });
  });
});
