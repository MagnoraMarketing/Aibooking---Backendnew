import { describe, it, expect, vi, beforeEach } from "vitest";

// Vapi's assistantOverrides REPLACES model.messages rather than adding to
// it. A campaign that sent only its own instruction would therefore place
// calls with that one line as the agent's entire prompt: no persona, no
// knowledge base, no instructions — an agent that has forgotten who it is,
// on a call to a real customer.

const vapiFetch = vi.fn();
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetch(...args),
}));

const { createOutboundCall } = await import("@/lib/vapi/calls");

function sentBody(): Record<string, unknown> {
  const [, init] = vapiFetch.mock.calls.at(-1) as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, unknown>;
}

function overrideContent(body: Record<string, unknown>): string | undefined {
  const overrides = body.assistantOverrides as { model?: { messages?: { content?: string }[] } } | undefined;
  return overrides?.model?.messages?.[0]?.content;
}

const CALL = {
  assistantId: "asst_1",
  phoneNumberId: "num_1",
  customerNumber: "+4512345678",
};

beforeEach(() => {
  vapiFetch.mockReset();
  // vapiFetch resolves with the raw Response the caller reads.
  vapiFetch.mockResolvedValue({ json: async () => ({ id: "call_1" }) });
});

describe("what a campaign call tells the agent", () => {
  it("sends the agent's own prompt with the campaign's purpose appended", async () => {
    await createOutboundCall({
      ...CALL,
      basePrompt: "Du er receptionist hos Frisørstuen.",
      campaignInstruction: "Ring og mind om tiden i morgen.",
    });

    const content = overrideContent(sentBody());
    expect(content).toContain("Du er receptionist hos Frisørstuen.");
    expect(content).toContain("Ring og mind om tiden i morgen.");
  });

  // Losing the instruction is a smaller loss than losing the prompt, so an
  // unresolvable prompt means no override at all.
  it("sends no override when the agent's prompt could not be resolved", async () => {
    await createOutboundCall({ ...CALL, campaignInstruction: "Ring og mind om tiden i morgen." });

    expect(sentBody().assistantOverrides).toBeUndefined();
  });

  it("leaves the assistant alone when the campaign has no instruction", async () => {
    await createOutboundCall({ ...CALL, basePrompt: "Du er receptionist hos Frisørstuen." });

    expect(sentBody().assistantOverrides).toBeUndefined();
  });

  it("always sends the assistant, the number and who to call", async () => {
    await createOutboundCall(CALL);
    const body = sentBody();

    expect(body).toMatchObject({
      assistantId: "asst_1",
      phoneNumberId: "num_1",
      customer: { number: "+4512345678" },
    });
  });
});
