import { describe, it, expect } from "vitest";
import { buildAssistantPatch, readAssistantConfig } from "@/lib/aibooking-dashboard/assistant-config";
import { endCallDirective } from "@/lib/i18n/agent-content";

// The platform's own assistants are hand-built in Vapi and edited from the
// Aibooking.dk Dashboard. These pin that an edit changes only what the
// admin changed, and that "læg på ved farvel" adds and removes both the tool
// and the instruction.

const END_CALL_TOOL = { type: "endCall", messages: [], function: { name: "endCall" } };
const BOOKING_TOOL = { type: "function", function: { name: "create_booking" } };

const ASSISTANT = {
  id: "asst_1",
  name: "Aibooking.dk Widget",
  firstMessage: "Hej, du taler med Aibooking.",
  transcriber: { provider: "deepgram", language: "da" },
  voice: { provider: "11labs", voiceId: "Elliot" },
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.4,
    messages: [{ role: "system", content: "Du er Aibookings sælger." }],
    tools: [BOOKING_TOOL],
    toolIds: ["tool_x"],
  },
};

describe("reading a hand-built assistant", () => {
  it("shows the prompt as written, with the end-call instruction taken back out", () => {
    const withDirective = {
      ...ASSISTANT,
      model: {
        ...ASSISTANT.model,
        messages: [{ role: "system", content: `Du er Aibookings sælger.\n\n${endCallDirective("da")}` }],
        tools: [BOOKING_TOOL, END_CALL_TOOL],
      },
    };
    const config = readAssistantConfig(withDirective);
    expect(config.systemPrompt).toBe("Du er Aibookings sælger.");
    expect(config.endCallOnGoodbye).toBe(true);
    expect(config.modelLabel).toBe("openai · gpt-4o");
    expect(config.language).toBe("da");
  });

  it("counts an end-call tool attached as a saved Vapi tool", () => {
    const config = readAssistantConfig(ASSISTANT, ["endCall"]);
    expect(config.endCallOnGoodbye).toBe(true);
    expect(config.endCallFromSavedTool).toBe(true);
  });
});

describe("writing it back", () => {
  it("turning on 'læg på ved farvel' adds the tool and the instruction, and keeps the rest of the model", () => {
    const body = buildAssistantPatch(ASSISTANT, { endCallOnGoodbye: true }, END_CALL_TOOL) as {
      model: { tools: unknown[]; messages: { content: string }[]; temperature: number; toolIds: string[] };
    };
    expect(body.model.tools).toEqual([BOOKING_TOOL, END_CALL_TOOL]);
    expect(body.model.messages[0]!.content).toBe(`Du er Aibookings sælger.\n\n${endCallDirective("da")}`);
    expect(body.model.temperature).toBe(0.4);
    expect(body.model.toolIds).toEqual(["tool_x"]);
  });

  it("turning it off removes both again", () => {
    const on = {
      ...ASSISTANT,
      model: {
        ...ASSISTANT.model,
        messages: [{ role: "system", content: `P\n\n${endCallDirective("da")}` }],
        tools: [BOOKING_TOOL, END_CALL_TOOL],
      },
    };
    const body = buildAssistantPatch(on, { endCallOnGoodbye: false }, END_CALL_TOOL) as {
      model: { tools: unknown[]; messages: { content: string }[] };
    };
    expect(body.model.tools).toEqual([BOOKING_TOOL]);
    expect(body.model.messages[0]!.content).toBe("P");
  });

  it("sends only the first message when that is all that changed", () => {
    expect(buildAssistantPatch(ASSISTANT, { firstMessage: "Hej!" }, END_CALL_TOOL)).toEqual({ firstMessage: "Hej!" });
  });

  it("never adds a second end-call tool next to a saved one", () => {
    const body = buildAssistantPatch(ASSISTANT, { systemPrompt: "Ny prompt" }, END_CALL_TOOL, ["endCall"]) as {
      model: { tools: unknown[]; messages: { content: string }[] };
    };
    expect(body.model.tools).toEqual([BOOKING_TOOL]);
    expect(body.model.messages[0]!.content).toContain("Ny prompt");
    expect(body.model.messages[0]!.content).toContain("Sådan afslutter du samtalen");
  });

  it("refuses to write a prompt when the model cannot be read", () => {
    expect(() => buildAssistantPatch({ model: {} }, { systemPrompt: "x" }, END_CALL_TOOL)).toThrow();
  });
});
