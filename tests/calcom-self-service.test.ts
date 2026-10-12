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
// The row the calendar_connections lookups resolve to — the source calendar
// when another agent's connection is being reused.
let calendarRow: Record<string, unknown> | null = null;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      let columns: string | null = null;
      const chain = {
        select(cols?: string) {
          if (typeof cols === "string") columns = cols;
          return chain;
        },
        eq: () => chain,
        update(payload: Record<string, unknown>) {
          recorded.push({ table, op: "update", payload });
          return chain;
        },
        upsert(payload: Record<string, unknown>) {
          recorded.push({ table, op: "upsert", payload });
          return chain;
        },
        maybeSingle: async () => ({ data: project(dataFor(table), columns), error: null }),
        single: async () => ({ data: project(dataFor(table), columns), error: null }),
      };
      return chain;
    },
  }),
}));

// PostgREST returns exactly the columns a query names, and a route that keeps
// the API key out of its responses does so by not selecting it. A mock that
// handed back every column regardless would let that protection rot unnoticed.
function project(row: Record<string, unknown> | null, columns: string | null) {
  if (!row || !columns || columns.trim() === "*") return row;
  const wanted = columns
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column && !column.includes("("));
  return Object.fromEntries(Object.entries(row).filter(([key]) => wanted.includes(key)));
}

function dataFor(table: string): Record<string, unknown> | null {
  if (table === "widgets") return widgetRow;
  if (table === "widget_settings") return { extra: { vapiAssistantId: "asst_1" } };
  if (table === "calendar_connections") return calendarRow;
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

// A key that Cal.com no longer accepts — the state a copied key can be in
// without anyone noticing until a caller tries to book.
let keyRevoked = false;

vi.mock("@/lib/calendar", () => ({
  fetchCalcomMe: async () => {
    if (keyRevoked) throw new Error("Cal.com afviste nøglen (401)");
    return { email: "kunde@example.dk", username: "kunde", timezone: "Europe/Copenhagen" };
  },
  fetchCalcomEventTypes: async () => eventTypesResult,
}));

vi.mock("@/lib/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security")>();
  return {
    ...actual,
    encryptSecret: (value: string) => `enc:${value}`,
    decryptSecret: (value: string) => value.replace(/^enc:/, ""),
    writeAuditLog: async () => {},
  };
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
  calendarRow = { id: "conn-1", widget_id: "widget-a", customer_id: "cust-a", provider: "calcom" };
  keyRevoked = false;
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

// Cal.com shows an API key exactly once. A customer who connected their
// widget weeks ago and now adds a phone agent cannot paste the same key
// again — it is gone — so without this they are pushed into issuing a second
// key for the same account, or into a second calendar the two agents then
// double-book each other in. The stored credential is copied server-side
// instead; the browser never sees it.
describe("putting a second agent on a calendar the customer already connected", () => {
  const SIBLING = {
    widgetId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    fromConnectionId: "9f8b1f3c-2c1a-4a51-9f1e-4b9d0a1c7e22",
  };

  beforeEach(() => {
    calendarRow = {
      id: "conn-widget",
      widget_id: "widget-b",
      customer_id: "cust-a",
      provider: "calcom",
      calcom_api_key: "enc:cal_live_secret",
      calcom_event_type_id: "43",
    };
  });

  it("copies the stored key onto the new agent without the browser sending one", async () => {
    const res = await POST(connectRequest(SIBLING), { params: {} });

    expect(res.status).toBe(201);
    const upsert = recorded.find((r) => r.table === "calendar_connections" && r.op === "upsert");
    expect(upsert?.payload).toMatchObject({ widget_id: "widget-a", calcom_api_key: "enc:cal_live_secret" });
  });

  it("books the same service as the calendar it came from", async () => {
    await POST(connectRequest(SIBLING), { params: {} });

    const upsert = recorded.find((r) => r.table === "calendar_connections" && r.op === "upsert");
    expect(upsert?.payload).toMatchObject({ calcom_event_type_id: "43" });
  });

  it("lets the customer point the new agent at a different service straight away", async () => {
    await POST(connectRequest({ ...SIBLING, eventTypeId: 42 }), { params: {} });

    const upsert = recorded.find((r) => r.table === "calendar_connections" && r.op === "upsert");
    expect(upsert?.payload).toMatchObject({ calcom_event_type_id: "42" });
  });

  it("turns booking on and re-syncs the assistant, same as a pasted key", async () => {
    await POST(connectRequest(SIBLING), { params: {} });

    expect(recorded).toContainEqual({ table: "widgets", op: "update", payload: { booking_enabled: true } });
    expect(syncWidgetToVapiAssistant).toHaveBeenCalledTimes(1);
  });

  it("never puts the copied key in the response", async () => {
    const res = await POST(connectRequest(SIBLING), { params: {} });

    expect(JSON.stringify(await res.json())).not.toContain("cal_live_secret");
  });

  // The key was good when the other agent was set up. That says nothing about
  // now, and a connection stored against a revoked key looks healthy right up
  // until a caller asks for a time.
  it("stores nothing when the copied key has since been revoked", async () => {
    keyRevoked = true;

    await POST(connectRequest(SIBLING), { params: {} });

    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
    expect(syncWidgetToVapiAssistant).not.toHaveBeenCalled();
  });

  it("refuses a calendar belonging to another customer", async () => {
    calendarRow = { ...(calendarRow as Record<string, unknown>), customer_id: "another-customer" };

    const res = await POST(connectRequest(SIBLING), { params: {} });

    expect(res.status).toBe(404);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });

  it("refuses to copy the agent's own calendar onto itself", async () => {
    calendarRow = { ...(calendarRow as Record<string, unknown>), widget_id: "widget-a" };

    const res = await POST(connectRequest(SIBLING), { params: {} });

    expect(res.status).toBe(400);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });

  it("refuses a Google connection, which carries no Cal.com key to share", async () => {
    calendarRow = { ...(calendarRow as Record<string, unknown>), provider: "google", calcom_api_key: null };

    const res = await POST(connectRequest(SIBLING), { params: {} });

    expect(res.status).toBe(400);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });

  it("refuses a request that names both a key and a calendar to copy", async () => {
    const res = await POST(connectRequest({ ...SIBLING, apiKey: "cal_live_other" }), { params: {} });

    expect(res.status).toBe(400);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });

  it("refuses a request that names neither", async () => {
    const res = await POST(connectRequest({ widgetId: SIBLING.widgetId }), { params: {} });

    expect(res.status).toBe(400);
    expect(recorded.some((r) => r.op === "upsert")).toBe(false);
  });
});
