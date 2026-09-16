import { describe, it, expect, vi, beforeEach } from "vitest";

// Connecting a Cal.com calendar from the dashboard has to do more than store
// the key: widgets.booking_enabled is the single gate the runtime reads (see
// 0030_optional_booking.sql), and the Vapi assistant only carries booking
// tools when it's on. Before this, a customer who connected their own
// calendar got a stored connection and an agent that still couldn't book —
// only an admin completing a booking_setup_request flipped the gate. These
// pin the self-service path so it can't regress to that.

interface Recorded {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
}

let recorded: Recorded[] = [];
let widgetRow: Record<string, unknown> | null = null;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        update(payload: Record<string, unknown>) {
          recorded.push({ table, op: "update", payload });
          return chain;
        },
        upsert(payload: Record<string, unknown>) {
          recorded.push({ table, op: "upsert", payload });
          return chain;
        },
        maybeSingle: async () => ({ data: dataFor(table), error: null }),
        single: async () => ({ data: dataFor(table), error: null }),
      };
      return chain;
    },
  }),
}));

function dataFor(table: string): Record<string, unknown> | null {
  if (table === "widgets") return widgetRow;
  if (table === "widget_settings") return { extra: { vapiAssistantId: "asst_1" } };
  if (table === "calendar_connections") return { id: "conn-1", widget_id: "widget-a", provider: "calcom" };
  return null;
}

vi.mock("@/lib/auth", () => ({
  requireCustomerAdmin: async () => ({ userId: "user-a", profile: { role: "CUSTOMER_ADMIN", customer_id: "cust-a" } }),
}));

const syncWidgetToVapiAssistant = vi.fn();
vi.mock("@/lib/vapi", () => ({ syncWidgetToVapiAssistant: (...args: unknown[]) => syncWidgetToVapiAssistant(...args) }));

// Mutable so a test can put Cal.com in the state where it reports no event
// types at all — a team-scoped key does exactly that.
let eventTypesResult: Array<{ id: number; title: string }> = [];

vi.mock("@/lib/calendar", () => ({
  fetchCalcomMe: async () => ({ email: "kunde@example.dk", username: "kunde", timezone: "Europe/Copenhagen" }),
  fetchCalcomEventTypes: async () => eventTypesResult,
}));

vi.mock("@/lib/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security")>();
  return { ...actual, encryptSecret: (value: string) => `enc:${value}`, writeAuditLog: async () => {} };
});

const { POST } = await import("@/app/api/customer/calendar/calcom/route");

function connectRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.dk/api/customer/calendar/calcom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  widgetId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  apiKey: "cal_live_secret",
};

beforeEach(() => {
  recorded = [];
  syncWidgetToVapiAssistant.mockClear();
  widgetRow = { id: "widget-a", customer_id: "cust-a", booking_enabled: false, llm_model_id: "llm-1" };
  eventTypesResult = [
    { id: 42, title: "Intro-møde" },
    { id: 43, title: "Opfølgning" },
  ];
});

describe("connecting Cal.com from the dashboard", () => {
  it("turns booking on for the agent, not just stores the key", async () => {
    const res = await POST(connectRequest(VALID_BODY), { params: {} });

    expect(res.status).toBe(201);
    expect(recorded).toContainEqual({ table: "widgets", op: "update", payload: { booking_enabled: true } });
  });

  it("re-syncs the Vapi assistant so it actually gains the booking tools", async () => {
    await POST(connectRequest(VALID_BODY), { params: {} });

    expect(syncWidgetToVapiAssistant).toHaveBeenCalledTimes(1);
    expect(syncWidgetToVapiAssistant).toHaveBeenCalledWith(widgetRow, { vapiAssistantId: "asst_1" });
  });

  it("encrypts the API key before it reaches the database", async () => {
    await POST(connectRequest(VALID_BODY), { params: {} });

    const upsert = recorded.find((r) => r.table === "calendar_connections" && r.op === "upsert");
    expect(upsert?.payload).toMatchObject({ calcom_api_key: "enc:cal_live_secret" });
  });

  it("never returns the key to the browser, but does return the event types to choose from", async () => {
    const res = await POST(connectRequest(VALID_BODY), { params: {} });
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain("cal_live_secret");
    expect(body.eventTypes).toHaveLength(2);
    expect(body.bookingEnabled).toBe(true);
  });

  it("defaults to the first event type when the customer hasn't picked one", async () => {
    await POST(connectRequest(VALID_BODY), { params: {} });

    const upsert = recorded.find((r) => r.table === "calendar_connections" && r.op === "upsert");
    expect(upsert?.payload).toMatchObject({ calcom_event_type_id: "42" });
  });

  it("rejects an event type that isn't on the customer's Cal.com account", async () => {
    const res = await POST(connectRequest({ ...VALID_BODY, eventTypeId: 999 }), { params: {} });

    expect(res.status).toBe(400);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });

  // Cal.com's /event-types only reports the personal types behind a key. A
  // customer whose booking lives on a team sees an empty list, and used to be
  // told to "create an event type first" on an account that already had one —
  // with no way past the error. The id they can read off the Cal.com URL is
  // the answer, so the connect route takes it on trust: the key itself is
  // already proven by fetchCalcomMe.
  it("accepts an event type id the customer typed when Cal.com lists none", async () => {
    eventTypesResult = [];

    const res = await POST(connectRequest({ ...VALID_BODY, eventTypeId: 1234567 }), { params: {} });

    expect(res.status).toBe(201);
    const upsert = recorded.find((r) => r.table === "calendar_connections" && r.op === "upsert");
    expect(upsert?.payload).toMatchObject({ calcom_event_type_id: "1234567" });
  });

  it("still refuses when Cal.com lists none and the customer named none either", async () => {
    eventTypesResult = [];

    const res = await POST(connectRequest(VALID_BODY), { params: {} });

    expect(res.status).toBe(400);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });

  it("refuses a widget belonging to someone else", async () => {
    widgetRow = { id: "widget-a", customer_id: "another-customer", booking_enabled: false };

    const res = await POST(connectRequest(VALID_BODY), { params: {} });

    expect(res.status).toBe(404);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
    expect(syncWidgetToVapiAssistant).not.toHaveBeenCalled();
  });
});
