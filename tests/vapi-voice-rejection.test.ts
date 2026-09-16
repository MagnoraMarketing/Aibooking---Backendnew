import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Vapi retires voices on its own schedule, and it refuses the whole PATCH
// when a retired one is named. That PATCH also carries the system prompt, the
// knowledge base and the booking/Shopify tools — so a stale voice name was
// silently stopping all of those from reaching the assistant.

const vapiFetchMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(new Response("{}")));
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));

vi.mock("@/lib/settings/platform", () => ({
  getVapiVoiceTemplateAssistantId: async () => null,
}));

import { updateVapiAssistant } from "@/lib/vapi/assistants";

const PARAMS = { name: "Agent", systemPrompt: "prompt", firstMessage: "hej", voiceGender: "female" as const };

const LILY_REJECTION = new Error(
  'Vapi afviste anmodningen (400): {"message":"The Lily voice is part of a legacy voice set that is being phased out, ' +
    'and assistants cannot be updated to use this voice.","error":"Bad Request","statusCode":400}'
);

function bodyOf(callIndex: number): Record<string, unknown> {
  const init = vapiFetchMock.mock.calls[callIndex]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vapiFetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("updateVapiAssistant", () => {
  it("sends the voice on the first attempt", async () => {
    await updateVapiAssistant("asst_1", PARAMS);

    expect(vapiFetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).voice).toMatchObject({ provider: "vapi" });
  });

  // The prompt, knowledge base and tools matter more than the voice.
  it("retries without the voice when Vapi rejects it, so the rest still syncs", async () => {
    vapiFetchMock.mockRejectedValueOnce(LILY_REJECTION).mockResolvedValue(new Response("{}"));

    await updateVapiAssistant("asst_1", PARAMS, true);

    expect(vapiFetchMock).toHaveBeenCalledTimes(2);
    const retry = bodyOf(1);
    expect(retry.voice).toBeUndefined();
    // Everything else survived the retry.
    expect(retry.name).toBe("Agent");
    expect((retry.model as { messages: { content: string }[] }).messages[0]!.content).toBe("prompt");
    expect((retry.model as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  // A failure that has nothing to do with the voice must still surface —
  // retrying it without the voice would hide a real problem.
  it("does not swallow an unrelated failure", async () => {
    const other = new Error('Vapi afviste anmodningen (401): {"message":"Unauthorized"}');
    vapiFetchMock.mockRejectedValue(other);

    await expect(updateVapiAssistant("asst_1", PARAMS)).rejects.toThrow(other);
    expect(vapiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than looping when the retry fails too", async () => {
    vapiFetchMock.mockRejectedValueOnce(LILY_REJECTION).mockRejectedValueOnce(new Error("still broken"));

    await expect(updateVapiAssistant("asst_1", PARAMS)).rejects.toThrow("still broken");
    expect(vapiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the fallback voice", () => {
  it("no longer names the voice Vapi retired", async () => {
    const { fallbackVoiceFor } = await import("@/lib/vapi/voice-gender");
    expect(fallbackVoiceFor("female").voiceId).not.toBe("Lily");
  });

  // A voice going stale must be fixable by setting a variable, not by a
  // deploy — that is the whole reason this outage lasted.
  it("can be overridden per gender without a deploy", async () => {
    const { fallbackVoiceFor } = await import("@/lib/vapi/voice-gender");

    process.env.VAPI_FALLBACK_VOICE_FEMALE = "Hana";
    process.env.VAPI_FALLBACK_VOICE_MALE = "Cole";

    expect(fallbackVoiceFor("female")).toEqual({ provider: "vapi", version: 2, voiceId: "Hana" });
    expect(fallbackVoiceFor("male")).toEqual({ provider: "vapi", version: 2, voiceId: "Cole" });
  });

  it("keeps honouring the customer's choice — the two genders never collapse to one voice", async () => {
    const { fallbackVoiceFor } = await import("@/lib/vapi/voice-gender");
    expect(fallbackVoiceFor("female").voiceId).not.toBe(fallbackVoiceFor("male").voiceId);
  });
});
