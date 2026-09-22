import { describe, it, expect, vi, beforeEach } from "vitest";

// Every agent that can book runs the same flow, on every channel: offer real
// times straight away whatever the meeting is about, let the customer say the
// whole email address (voice agents wait a second of silence for it), read it
// back for a yes, and only book once the customer has accepted the summary.

const vapiFetchMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(new Response("{}")));
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));

vi.mock("@/lib/settings/platform", () => ({
  getVapiVoiceTemplateAssistantId: async () => null,
}));

import { createVapiAssistant, updateVapiAssistant, EMAIL_PAUSE_RULE } from "@/lib/vapi/assistants";
import { bookingFlowDirective, withBookingFlowDirective } from "@/lib/i18n/agent-content";

const PARAMS = { name: "Agent", systemPrompt: "prompt", firstMessage: "hej", voiceGender: "female" as const };

function bodyOf(callIndex: number): Record<string, unknown> {
  const init = vapiFetchMock.mock.calls[callIndex]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function systemMessage(callIndex: number): string {
  return (bodyOf(callIndex).model as { messages: { content: string }[] }).messages[0]!.content;
}

beforeEach(() => {
  vapiFetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the booking flow directive", () => {
  it("exists for every language the platform speaks", () => {
    for (const lang of ["da", "en", "es", "fr", "pt", "de"]) {
      const directive = bookingFlowDirective(lang);
      expect(directive.length).toBeGreaterThan(200);
      expect(directive).toMatch(/^### /);
    }
  });

  it("falls back to Danish for an unknown language", () => {
    expect(bookingFlowDirective("xx")).toBe(bookingFlowDirective("da"));
  });

  it("covers speed, email read-back and waiting for the customer's yes", () => {
    const da = bookingFlowDirective("da");
    expect(da).toContain("Uanset hvad mødet handler om");
    expect(da).toContain("Læs e-mailadressen tilbage");
    expect(da).toContain("Er det korrekt?");
    expect(da).toContain("Book først, når kunden tydeligt har sagt ja");
  });

  it("is appended after the customer's own prompt", () => {
    expect(withBookingFlowDirective("prompt", "en")).toBe(`prompt\n\n${bookingFlowDirective("en")}`);
  });
});

describe("a Vapi agent with booking tools", () => {
  it("runs on the booking flow, in its own language", async () => {
    await createVapiAssistant({ ...PARAMS, language: "en" }, true);

    expect(systemMessage(0)).toBe(`prompt\n\n${bookingFlowDirective("en")}`);
  });

  it("reaches an existing assistant through an update too", async () => {
    await updateVapiAssistant("asst_1", { ...PARAMS, language: "da" }, true);

    expect(systemMessage(0)).toContain("Sådan booker du et møde");
  });

  it("is not told the booking flow when it cannot book", async () => {
    await createVapiAssistant({ ...PARAMS, language: "da" }, false);

    expect(systemMessage(0)).not.toContain("Sådan booker du et møde");
    expect(systemMessage(0)).toContain("Du kan ikke booke");
  });
});

describe("the pause after asking for an email", () => {
  it("is sent on every assistant, with one second of silence", async () => {
    await createVapiAssistant(PARAMS, true);

    expect(bodyOf(0).startSpeakingPlan).toEqual({ customEndpointingRules: [EMAIL_PAUSE_RULE] });
    expect(EMAIL_PAUSE_RULE).toMatchObject({ type: "assistant", timeoutSeconds: 1 });
  });

  it("matches the agent asking for an email, in every language", () => {
    const regex = new RegExp(EMAIL_PAUSE_RULE.regex);
    for (const question of [
      "Hvad er din e-mailadresse?",
      "Må jeg få din mail?",
      "What's your email address?",
      "¿Cuál es tu correo electrónico?",
      "Quelle est votre adresse e-mail ?",
      "Qual é o seu e-mail?",
      "Wie lautet Ihre E-Mail-Adresse?",
    ]) {
      expect(regex.test(question), question).toBe(true);
    }
  });

  it("leaves every other turn at its normal timing", () => {
    const regex = new RegExp(EMAIL_PAUSE_RULE.regex);
    for (const line of ["Hvilken tid passer dig bedst?", "Hvad er dit navn?", "Skal jeg booke torsdag kl. 10?"]) {
      expect(regex.test(line), line).toBe(false);
    }
  });

  it("is dropped, not fatal, if Vapi rejects it on update", async () => {
    vapiFetchMock
      .mockRejectedValueOnce(new Error('Vapi afviste anmodningen (400): {"message":["startSpeakingPlan.customEndpointingRules is invalid"]}'))
      .mockResolvedValue(new Response("{}"));

    await updateVapiAssistant("asst_1", PARAMS, true);

    expect(vapiFetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).startSpeakingPlan).toBeUndefined();
    expect(systemMessage(1)).toContain("Sådan booker du et møde");
  });

  it("is dropped, not fatal, if Vapi rejects it on create", async () => {
    vapiFetchMock
      .mockRejectedValueOnce(new Error('Vapi afviste anmodningen (400): {"message":["startSpeakingPlan should be an object"]}'))
      .mockResolvedValue(new Response(JSON.stringify({ id: "asst_new" })));

    const result = await createVapiAssistant(PARAMS, true);

    expect(result.id).toBe("asst_new");
    expect(bodyOf(1).startSpeakingPlan).toBeUndefined();
  });
});
