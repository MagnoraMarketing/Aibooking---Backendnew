import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Inbound is Vapi and nothing else: the agent is handed a number by Vapi,
// already wired to its assistant, and the customer forwards their existing
// line to it. Nobody pastes Twilio credentials, and nobody moves the number
// their own customers already call.

const vapiFetchMock = vi.fn();
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));

import { createVapiManagedNumber, attachAssistantToVapiNumber } from "@/lib/vapi/phone-numbers";

function callAt(index: number): { url: string; init: RequestInit } {
  const call = vapiFetchMock.mock.calls[index]!;
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function bodyAt(index: number): Record<string, unknown> {
  return JSON.parse(String(callAt(index).init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vapiFetchMock.mockReset();
  vapiFetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "num_1", number: "+15139407163" })));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("asking Vapi for an inbound number", () => {
  it("asks for a Vapi-provided number bound to the agent's assistant", async () => {
    const number = await createVapiManagedNumber({ assistantId: "asst_1", name: "Frisørstuen" });

    expect(callAt(0).url).toBe("/phone-number");
    expect(callAt(0).init.method).toBe("POST");
    expect(bodyAt(0)).toMatchObject({ provider: "vapi", assistantId: "asst_1", name: "Frisørstuen" });
    expect(number).toEqual({ id: "num_1", number: "+15139407163" });
  });

  // Vapi rejects a request without one: "At least one of
  // numberDesiredAreaCode, sipUri must be provided". There is no letting it
  // choose, so the customer must not be the one left holding that question.
  it("always sends an area code, even when the customer named none", async () => {
    await createVapiManagedNumber({ assistantId: "asst_1" });

    expect(bodyAt(0).numberDesiredAreaCode).toMatch(/^\d{3}$/);
    expect(vapiFetchMock).toHaveBeenCalledTimes(1);
  });

  // An area code Vapi has run dry of is a dead end the customer can neither
  // see nor fix, so an unasked-for one is retried elsewhere.
  it("tries another area code when the first has no numbers left", async () => {
    vapiFetchMock
      .mockRejectedValueOnce(new Error("Vapi afviste anmodningen (400): no numbers available"))
      .mockResolvedValue(new Response(JSON.stringify({ id: "num_9", number: "+12125550123" })));

    const number = await createVapiManagedNumber({ assistantId: "asst_1" });

    expect(vapiFetchMock).toHaveBeenCalledTimes(2);
    expect(bodyAt(0).numberDesiredAreaCode).not.toBe(bodyAt(1).numberDesiredAreaCode);
    expect(number.id).toBe("num_9");
  });

  // A code the customer typed is theirs: they get that one, or the real
  // reason it failed — never a number in a different city.
  it("does not shop around when the customer named an area code", async () => {
    vapiFetchMock.mockRejectedValue(new Error("Vapi afviste anmodningen (400): no numbers available"));

    await expect(createVapiManagedNumber({ assistantId: "asst_1", areaCode: "415" })).rejects.toThrow(
      /no numbers available/
    );
    expect(vapiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes a chosen area code through under Vapi's own field name", async () => {
    await createVapiManagedNumber({ assistantId: "asst_1", areaCode: "312" });

    expect(bodyAt(0).numberDesiredAreaCode).toBe("312");
  });

  // The number can take a moment to be allotted; the id is what we store, so
  // a response without one yet must not crash the request that created it.
  it("survives a response that has no number yet", async () => {
    vapiFetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "num_2" })));

    await expect(createVapiManagedNumber({ assistantId: "asst_1" })).resolves.toEqual({ id: "num_2", number: "" });
  });
});

describe("pointing a number at another assistant", () => {
  it("PATCHes the number rather than creating a second one", async () => {
    vapiFetchMock.mockResolvedValue(new Response("{}"));

    await attachAssistantToVapiNumber("num_1", "asst_2");

    expect(callAt(0).url).toBe("/phone-number/num_1");
    expect(callAt(0).init.method).toBe("PATCH");
    expect(bodyAt(0)).toEqual({ assistantId: "asst_2" });
  });
});
