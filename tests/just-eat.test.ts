import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

// Just Eat (JET Go) delivery for an agent: API key encrypted and never shown,
// estimate → yes → create through JET Go, status only for this agent's own
// deliveries (from its token-protected webhook), and never a throw.

process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let settingsExtra: Record<string, unknown> | null = null;
let widgetRow: Record<string, unknown> | null = null;
let auditRows: Record<string, unknown>[] = [];

// Audit rows are matched on the same filters the code applies, so "only this
// agent's deliveries" is really exercised rather than stubbed.
function matches(row: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([column, value]) => {
    const m = column.match(/^metadata->>(.+)$/);
    if (m) return (row.metadata as Record<string, unknown> | undefined)?.[m[1]!] === value;
    return row[column] === value;
  });
}

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        insert: async (row: Record<string, unknown>) => {
          auditRows.push({ ...row, created_at: new Date(Date.now() + auditRows.length).toISOString() });
          return { error: null };
        },
        maybeSingle: async () => {
          if (table === "widget_settings") return { data: settingsExtra ? { extra: settingsExtra } : null, error: null };
          if (table === "widgets") return { data: widgetRow, error: null };
          if (table === "audit_logs") {
            const found = [...auditRows].reverse().find((row) => matches(row, filters));
            return { data: found ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }),
}));

const { mergeJustEatInput, summarizeJustEat, resolveJustEatConfig, removeJustEat, justEatWebhookToken } = await import(
  "@/lib/just-eat/connection"
);
const { publicWidgetExtra } = await import("@/lib/uber-direct/connection");
const { executeJustEatTool } = await import("@/lib/just-eat/agent-tools");
const { POST: webhookPOST } = await import("@/app/api/webhooks/just-eat/[widgetId]/route");

const INPUT = {
  enabled: true,
  apiKey: "jet-secret-key",
  pickup: {
    name: "Pizzeria Roma",
    phone: "+4512345678",
    street: "Vesterbrogade 1",
    postalCode: "1620",
    city: "København V",
    country: "DK",
  },
};

const fetchMock = vi.fn();
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ADDRESS = { dropoff_street: "Nørrebrogade 10", dropoff_postal_code: "2200", dropoff_city: "København N" };

beforeEach(() => {
  settingsExtra = mergeJustEatInput({ vapiAssistantId: "asst_1" }, INPUT);
  widgetRow = { id: "widget-a", customer_id: "cust-a" };
  auditRows = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storing an agent's Just Eat setup", () => {
  it("encrypts the API key and never exposes it", () => {
    expect(JSON.stringify(settingsExtra)).not.toContain("jet-secret-key");
    expect(summarizeJustEat(settingsExtra)).toMatchObject({ enabled: true, hasApiKey: true });
    const shown = publicWidgetExtra(settingsExtra!);
    expect(shown.vapiAssistantId).toBe("asst_1");
    expect(JSON.stringify(shown)).not.toContain("apiKeyEncrypted");
    expect(JSON.stringify(shown)).not.toContain("webhookTokenEncrypted");
  });

  it("keeps the stored key and webhook token when an edit leaves the key out", () => {
    const token = justEatWebhookToken(settingsExtra);
    const { apiKey: _omit, ...withoutKey } = INPUT;
    const edited = mergeJustEatInput(settingsExtra!, { ...withoutKey, pickup: { ...INPUT.pickup, city: "Kbh V" } });
    expect(resolveJustEatConfig(edited)?.apiKey).toBe("jet-secret-key");
    expect(justEatWebhookToken(edited)).toBe(token);
  });

  it("gives the agent no delivery setup when switched off or removed", () => {
    expect(resolveJustEatConfig(mergeJustEatInput({}, { ...INPUT, enabled: false }))).toBeNull();
    expect(resolveJustEatConfig(removeJustEat(settingsExtra!))).toBeNull();
  });
});

describe("the Just Eat delivery tools", () => {
  it("gets an estimate with price, collecting from the business's own address", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ requestId: "req_1", fee: { amount: 3900, currency: "DKK" }, estimatedDeliverTime: "2026-10-12T18:30:00Z" })
    );

    const result = JSON.parse(await executeJustEatTool("justeat_delivery_quote", ADDRESS, "widget-a", "cust-a"));

    expect(result).toMatchObject({ ok: true, request_id: "req_1", price: "39.00 DKK", dropoff_eta: "2026-10-12T18:30:00Z" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api-daas.skipthedishes.com/v1/delivery/estimate");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer jet-secret-key" });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.collectDetails.address.line1).toBe("Vesterbrogade 1");
    expect(body.deliverDetails.address.postalCode).toBe("2200");
  });

  it("refuses an estimate without a full address and an order without a request id", async () => {
    expect(JSON.parse(await executeJustEatTool("justeat_delivery_quote", { dropoff_city: "Kbh" }, "widget-a", "cust-a"))).toEqual({
      ok: false,
      error: "missing_address",
    });
    expect(JSON.parse(await executeJustEatTool("justeat_create_delivery", {}, "widget-a", "cust-a"))).toEqual({
      ok: false,
      error: "missing_quote",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the delivery with the estimate's request id and logs it for this agent", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deliveryId: "jet_del_1", status: "created", trackingUrl: "https://t.je/x" }));

    const result = JSON.parse(
      await executeJustEatTool(
        "justeat_create_delivery",
        { request_id: "req_1", order_reference: "A-1001", dropoff_notes: "3. sal", order_value_dkk: 245.5 },
        "widget-a",
        "cust-a"
      )
    );

    expect(result).toMatchObject({ ok: true, delivery_id: "jet_del_1", tracking_url: "https://t.je/x" });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({
      requestId: "req_1",
      vendorOrderId: "A-1001",
      specialInstructions: "3. sal",
      orderValue: 24550,
      metadata: { widgetId: "widget-a", orderReference: "A-1001" },
    });
    expect(auditRows.at(-1)).toMatchObject({ action: "just_eat.delivery_created", entity_id: "jet_del_1" });
  });

  it("reports status from the webhook, and only for this agent's deliveries", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deliveryId: "jet_del_1", status: "created" }));
    await executeJustEatTool("justeat_create_delivery", { request_id: "req_1", order_reference: "A-1001" }, "widget-a", "cust-a");

    const token = justEatWebhookToken(settingsExtra)!;
    await webhookPOST(
      new Request(`https://example.dk/api/webhooks/just-eat/widget-a?token=${token}`, {
        method: "POST",
        body: JSON.stringify({ event: "courier_assigned", data: { deliveryId: "jet_del_1", status: "COURIER_ASSIGNED", courier: { name: "Ali" } } }),
      }),
      { params: { widgetId: "widget-a" } }
    );

    const byRef = JSON.parse(await executeJustEatTool("justeat_delivery_status", { order_reference: "A-1001" }, "widget-a", "cust-a"));
    expect(byRef).toMatchObject({ ok: true, delivery_id: "jet_del_1", status: "COURIER_ASSIGNED", courier: "Ali" });

    const otherAgent = JSON.parse(await executeJustEatTool("justeat_delivery_status", { delivery_id: "jet_del_1" }, "widget-b", "cust-a"));
    expect(otherAgent).toEqual({ ok: false, error: "not_found" });
  });

  it("answers honestly without a setup, and turns API errors into something sayable", async () => {
    settingsExtra = null;
    expect(JSON.parse(await executeJustEatTool("justeat_delivery_quote", ADDRESS, "widget-a", "cust-a"))).toEqual({
      ok: false,
      error: "not_connected",
    });

    settingsExtra = mergeJustEatInput({}, INPUT);
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));
    expect(JSON.parse(await executeJustEatTool("justeat_delivery_quote", ADDRESS, "widget-a", "cust-a"))).toEqual({
      ok: false,
      error: "not_authorized",
    });
  });
});

describe("the Just Eat status webhook", () => {
  const body = JSON.stringify({ data: { deliveryId: "jet_del_9", status: "DELIVERED" } });
  const post = (url: string) => webhookPOST(new Request(url, { method: "POST", body }), { params: { widgetId: "widget-a" } });

  it("records an update that carries the agent's token", async () => {
    const res = await post(`https://example.dk/api/webhooks/just-eat/widget-a?token=${justEatWebhookToken(settingsExtra)}`);
    expect(res.status).toBe(200);
    expect(auditRows.at(-1)).toMatchObject({ action: "just_eat.delivery_status", entity_id: "jet_del_9" });
  });

  it("rejects an update with a wrong or missing token", async () => {
    expect((await post("https://example.dk/api/webhooks/just-eat/widget-a?token=wrong")).status).toBe(401);
    expect((await post("https://example.dk/api/webhooks/just-eat/widget-a")).status).toBe(401);
    expect(auditRows).toHaveLength(0);
  });

  it("trusts nothing for an agent without a Just Eat setup", async () => {
    settingsExtra = {};
    expect((await post("https://example.dk/api/webhooks/just-eat/widget-a?token=x")).status).toBe(202);
    expect(auditRows).toHaveLength(0);
  });
});
