import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { body: Record<string, unknown> }[] = [];
let failFirstWith: string | null = null;

vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: async (_path: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    if (failFirstWith && calls.length === 1) throw new Error(failFirstWith);
    return new Response(JSON.stringify({ id: "call_1" }));
  },
}));

import { createOutboundCall, OUTCOME_ANALYSIS_PLAN } from "@/lib/vapi/calls";

const base = { assistantId: "asst", phoneNumberId: "pn", customerNumber: "+4512345678" };

describe("createOutboundCall", () => {
  beforeEach(() => {
    calls.length = 0;
    failFirstWith = null;
  });

  it("sends the lead's variables, the voicemail message and the outcome analysis", async () => {
    await createOutboundCall({ ...base, variables: { name: "Jens", city: "Aarhus" }, voicemailMessage: "Ring tilbage" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      customer: { number: "+4512345678", name: "Jens" },
      assistantOverrides: {
        variableValues: { name: "Jens", city: "Aarhus" },
        voicemailMessage: "Ring tilbage",
        analysisPlan: OUTCOME_ANALYSIS_PLAN,
      },
    });
  });

  it("places the call without the analysis when Vapi refuses that field", async () => {
    failFirstWith = 'Vapi afviste anmodningen (400): {"message":["assistantOverrides.analysisPlan.property x should not exist"]}';
    const result = await createOutboundCall({ ...base, variables: { name: "Jens" } });
    expect(result.id).toBe("call_1");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.assistantOverrides).toEqual({ variableValues: { name: "Jens" } });
  });

  it("does not retry any other refusal", async () => {
    failFirstWith = "Vapi afviste anmodningen (400): Couldn't Create Call. international calls not allowed";
    await expect(createOutboundCall(base)).rejects.toThrow(/international/);
    expect(calls).toHaveLength(1);
  });
});
