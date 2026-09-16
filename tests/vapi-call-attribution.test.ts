import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Three real inbound calls arrived, were answered, and vanished: no
// phone_calls row, no billing, nothing in the log. The number had been
// re-pointed at another assistant in Vapi's own dashboard, so the lookup
// from assistant to agent found nothing — and the handler returned.
//
// A call that reaches no agent is one nobody is billed for and nobody can
// see happened. The line it came in on is the second answer, and the
// platform assigns each number to exactly one agent.

interface Row {
  [key: string]: unknown;
}

let settingsRow: Row | null = null;
let widgetRow: Row | null = null;
let phoneNumberRow: Row | null = null;
let inserted: Row[] = [];

vi.mock("@/lib/database/admin", () => ({ getAdminClient: () => client }));

const client = {
  from(table: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      update: () => chain,
      insert(payload: Row) {
        inserted.push({ table, ...payload });
        return { error: null };
      },
      maybeSingle: async () => ({ data: dataFor(table), error: null }),
    };
    return chain;
  },
};

function dataFor(table: string): Row | null {
  if (table === "widget_settings") return settingsRow;
  if (table === "widgets") return widgetRow;
  if (table === "phone_numbers") return phoneNumberRow;
  // No prior phone_calls row (not a redelivery) and no campaign contact.
  return null;
}

const deductPhoneCallCost = vi.fn(async () => {});
vi.mock("@/lib/credits", () => ({
  deductPhoneCallCost: (...args: unknown[]) => deductPhoneCallCost(...args),
}));

vi.mock("@/lib/vapi/booking-tools", () => ({
  executeBookingTool: async () => ({}),
  resolveToolContext: async () => null,
}));

// The route rejects anything without the shared secret Vapi echoes back.
const WEBHOOK_SECRET = "test-secret";
process.env.VAPI_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { POST } = await import("@/app/api/webhooks/vapi/route");

function endOfCall(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://example.dk/api/webhooks/vapi", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vapi-secret": WEBHOOK_SECRET },
    body: JSON.stringify({
      message: {
        type: "end-of-call-report",
        durationSeconds: 37,
        endedReason: "customer-ended-call",
        call: { id: "call_1", assistantId: "asst_live", phoneNumberId: "num_1" },
        ...overrides,
      },
    }),
  });
}

function recordedCall(): Row | undefined {
  return inserted.find((row) => row.table === "phone_calls");
}

beforeEach(() => {
  inserted = [];
  deductPhoneCallCost.mockClear();
  settingsRow = { widget_id: "widget-a" };
  widgetRow = { id: "widget-a", customer_id: "cust-a" };
  phoneNumberRow = { id: "pn-1", widget_id: "widget-a", customer_id: "cust-a", released_at: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attributing a Vapi call", () => {
  it("bills the agent whose assistant took the call", async () => {
    await POST(endOfCall());

    expect(recordedCall()).toMatchObject({ widget_id: "widget-a", customer_id: "cust-a", duration_seconds: 37 });
    expect(deductPhoneCallCost).toHaveBeenCalledTimes(1);
  });

  // The assistant on the number was changed in Vapi's dashboard; our stored
  // one no longer matches. The call still happened and still costs money.
  it("falls back to the agent that owns the number when the assistant matches nothing", async () => {
    settingsRow = null;
    phoneNumberRow = { id: "pn-1", widget_id: "widget-b", customer_id: "cust-b", released_at: null };

    await POST(endOfCall());

    expect(recordedCall()).toMatchObject({ widget_id: "widget-b", customer_id: "cust-b", phone_number_id: "pn-1" });
    expect(deductPhoneCallCost).toHaveBeenCalledTimes(1);
  });

  // Drift is a configuration fault someone has to fix; recording the call
  // must not hide that it happened.
  it("says in the log that the mapping has drifted", async () => {
    settingsRow = null;

    await POST(endOfCall());

    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/drifted apart/));
  });

  // A released number's agent is whoever had it last — not a claim worth
  // making about a live call.
  it("does not attribute a call to the previous owner of a released number", async () => {
    settingsRow = null;
    phoneNumberRow = { id: "pn-1", widget_id: "widget-b", customer_id: "cust-b", released_at: "2026-09-16T22:00:00Z" };

    await POST(endOfCall());

    expect(recordedCall()).toBeUndefined();
    expect(deductPhoneCallCost).not.toHaveBeenCalled();
  });

  it("never drops a call silently", async () => {
    settingsRow = null;
    phoneNumberRow = null;

    await POST(endOfCall());

    expect(recordedCall()).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/not recorded, not billed/));
  });

  // A web call carries no phoneNumberId, so there is no line to fall back
  // to — that one is genuinely unattributable, and must say so.
  it("reports an unattributable web call rather than returning quietly", async () => {
    settingsRow = null;

    await POST(endOfCall({ call: { id: "call_2", assistantId: "asst_gone" } }));

    expect(recordedCall()).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/belongs to no agent/));
  });
});
