import { describe, it, expect, vi, beforeEach } from "vitest";

const getVapiVoiceTemplateAssistantIdMock = vi.fn(async (_gender: string): Promise<string | null> => null);
const vapiFetchMock = vi.fn();

vi.mock("@/lib/settings/platform", () => ({
  getVapiVoiceTemplateAssistantId: (gender: string) => getVapiVoiceTemplateAssistantIdMock(gender),
  getDefaultSystemPrompt: async () => "prompt",
}));

vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));

import { createVapiAssistant } from "@/lib/vapi/assistants";
import { DEFAULT_VOICE_GENDER, FALLBACK_VOICE_BY_GENDER } from "@/lib/vapi/voice-gender";

// What the assistant body actually sent to Vapi says the voice is — the only
// thing that decides what a caller hears.
function voiceSentToVapi(): Record<string, unknown> {
  const createCall = vapiFetchMock.mock.calls.find(([path, init]) => path === "/assistant" && (init as RequestInit)?.method === "POST");
  const body = JSON.parse((createCall![1] as RequestInit).body as string);
  return body.voice;
}

async function create(voiceGender: "male" | "female" | null | undefined) {
  await createVapiAssistant({ name: "Agent", systemPrompt: "p", firstMessage: "hej", voiceGender });
}

describe("a chosen voice gender survives every fallback path", () => {
  beforeEach(() => {
    getVapiVoiceTemplateAssistantIdMock.mockReset();
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue(null);
    vapiFetchMock.mockReset();
    vapiFetchMock.mockResolvedValue({ json: async () => ({ id: "asst_1" }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("uses the configured female template when there is one", async () => {
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue("asst_female_template");
    vapiFetchMock.mockImplementation(async (path: string) =>
      path === "/assistant"
        ? { json: async () => ({ id: "asst_1" }) }
        : { json: async () => ({ voice: { provider: "11labs", voiceId: "Freja" } }) }
    );

    await create("female");

    expect(getVapiVoiceTemplateAssistantIdMock).toHaveBeenCalledWith("female");
    expect(voiceSentToVapi()).toEqual({ provider: "11labs", voiceId: "Freja" });
  });

  it("falls back to a FEMALE voice when no female template is configured", async () => {
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue(null);

    await create("female");

    expect(voiceSentToVapi()).toEqual(FALLBACK_VOICE_BY_GENDER.female);
    expect(voiceSentToVapi()).not.toEqual(FALLBACK_VOICE_BY_GENDER.male);
  });

  it("falls back to a FEMALE voice when Vapi can't be read", async () => {
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue("asst_female_template");
    vapiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/assistant") return { json: async () => ({ id: "asst_1" }) };
      throw new Error("Vapi unreachable");
    });

    await create("female");

    expect(voiceSentToVapi()).toEqual(FALLBACK_VOICE_BY_GENDER.female);
  });

  it("falls back to a FEMALE voice when the template has no voice block", async () => {
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue("asst_female_template");
    vapiFetchMock.mockImplementation(async (path: string) =>
      path === "/assistant" ? { json: async () => ({ id: "asst_1" }) } : { json: async () => ({}) }
    );

    await create("female");

    expect(voiceSentToVapi()).toEqual(FALLBACK_VOICE_BY_GENDER.female);
  });

  it("keeps a male choice male", async () => {
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue(null);

    await create("male");

    expect(voiceSentToVapi()).toEqual(FALLBACK_VOICE_BY_GENDER.male);
  });

  it("treats no stored choice as the platform default, not as 'no gender'", async () => {
    getVapiVoiceTemplateAssistantIdMock.mockResolvedValue(null);

    await create(null);

    expect(getVapiVoiceTemplateAssistantIdMock).toHaveBeenCalledWith(DEFAULT_VOICE_GENDER);
    expect(voiceSentToVapi()).toEqual(FALLBACK_VOICE_BY_GENDER[DEFAULT_VOICE_GENDER]);
  });

  it("defaults to the female voice, which is what the picker shows preselected", () => {
    expect(DEFAULT_VOICE_GENDER).toBe("female");
  });
});
