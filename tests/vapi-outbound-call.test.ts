import { describe, it, expect, vi, beforeEach } from "vitest";

const vapiFetchMock = vi.fn();
vi.mock("@/lib/vapi/client", () => ({ vapiFetch: (...args: unknown[]) => vapiFetchMock(...args) }));

import { createOutboundCall } from "@/lib/vapi/calls";

function json(body: unknown) {
  return { ok: true, json: async () => body };
}

function sentCall() {
  const call = vapiFetchMock.mock.calls.find(([path]) => path === "/call")!;
  return JSON.parse(call[1].body as string);
}

describe("createOutboundCall", () => {
  beforeEach(() => vapiFetchMock.mockReset());

  // Vapi refused a messages-only model override ("model.provider must be one
  // of…"), which failed every campaign call that had an instruction.
  it("sends the assistant's whole model with the campaign instruction appended", async () => {
    vapiFetchMock.mockImplementation(async (path: string) =>
      path === "/call"
        ? json({ id: "call-1" })
        : json({
            model: {
              provider: "openai",
              model: "gpt-4o",
              toolIds: ["tool-1"],
              messages: [{ role: "system", content: "Du er receptionist." }],
            },
          })
    );

    const result = await createOutboundCall({
      assistantId: "asst-1",
      phoneNumberId: "pn-1",
      customerNumber: "+4512345678",
      campaignInstruction: "Book et møde om solceller.",
    });

    expect(result.id).toBe("call-1");
    const model = sentCall().assistantOverrides.model;
    expect(model.provider).toBe("openai");
    expect(model.model).toBe("gpt-4o");
    expect(model.toolIds).toEqual(["tool-1"]);
    expect(model.messages).toEqual([
      { role: "system", content: "Du er receptionist." },
      { role: "system", content: "### Formålet med dette opkald\nBook et møde om solceller." },
    ]);
  });

  it("sends no override without an instruction, and doesn't read the assistant", async () => {
    vapiFetchMock.mockResolvedValue(json({ id: "call-2" }));

    await createOutboundCall({ assistantId: "asst-1", phoneNumberId: "pn-1", customerNumber: "+4512345678" });

    expect(vapiFetchMock).toHaveBeenCalledTimes(1);
    expect(sentCall().assistantOverrides).toBeUndefined();
  });

  it("still places the call when the assistant has no usable model", async () => {
    vapiFetchMock.mockImplementation(async (path: string) =>
      path === "/call" ? json({ id: "call-3" }) : json({ model: { messages: [] } })
    );

    const result = await createOutboundCall({
      assistantId: "asst-1",
      phoneNumberId: "pn-1",
      customerNumber: "+4512345678",
      campaignInstruction: "Book et møde.",
    });

    expect(result.id).toBe("call-3");
    expect(sentCall().assistantOverrides).toBeUndefined();
  });
});
