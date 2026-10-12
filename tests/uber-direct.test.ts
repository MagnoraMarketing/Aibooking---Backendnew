import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

// Uber Direct delivery for an agent: credentials encrypted and never shown,
// quote → yes → create through Uber's API, status only for this agent's own
// deliveries, and a signed status webhook.

process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let settingsExtra: Record<string, unknown> | null = null;
let widgetRow: Record<string, unknown> | null = null;
let auditRows: Record<string, unknown>[] = [];
let ownedDeliveryIds: string[] = [];

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
          auditRows.push(row);
          return { error: null };
        },
        maybeSingle: async () => {
          if (table === "widget_settings") return { data: settingsExtra ? { extra: settingsExtra } : null, error: null };
          if (table === "widgets") return { data: widgetRow, error: null };
          if (table === "audit_logs") {
            const id = filters.entity_id as string | undefined;
            if (id) return { data: ownedDeliveryIds.includes(id) ? { id: "log" } : null, error: null };
            const ref = filters["metadata->>orderReference"];
            return { data: ref === "A-1001" ? { entity_id: "del_ref" } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }),
}));

const {
  mergeUberDirectInput,
  summarizeUberDirect,
  publicWidgetExtra,
  resolveUberDirectConfig,
  removeUberDirect,
} = await import("@/lib/uber-direct/connection");
const { executeUberDirectTool, normalizePhone } = await import("@/lib/uber-direct/agent-tools");
const { clearUberTokenCache, formatUberAddress } = await import("@/lib/uber-direct/api");
const { POST: webhookPOST } = await import("@/app/api/webhooks/uber-direct/[widgetId]/route");

const INPUT = {
  enabled: true,
  customerId: "cust_123",
  clientId: "client_abc",
  clientSecret: "super-secret",
  webhookSigningKey: "signing-key",
  pickup: {
    name: "Bageriet",
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

beforeEach(() => {
  settingsExtra = mergeUberDirectInput({ vapiAssistantId: "asst_1" }, INPUT);
  widgetRow = { id: "widget-a", customer_id: "cust-a" };
  auditRows = [];
  ownedDeliveryIds = [];
  clearUberTokenCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storing an agent's Uber Direct setup", () => {
  it("encrypts the secrets and never exposes them in the summary", () => {
    const stored = JSON.stringify(settingsExtra);
    expect(stored).not.toContain("super-secret");
    expect(stored).not.toContain("signing-key");

    const summary = summarizeUberDirect(settingsExtra);
    expect(summary).toMatchObject({ enabled: true, customerId: "cust_123", hasClientSecret: true, hasWebhookSigningKey: true });
    expect(JSON.stringify(summary)).not.toContain("Encrypted");
  });

  it("strips ciphertexts from anything sent to a browser, keeping other keys", () => {
    const shown = publicWidgetExtra(settingsExtra!);
    expect(shown.vapiAssistantId).toBe("asst_1");
    expect(JSON.stringify(shown)).not.toContain("clientSecretEncrypted");
  });

  it("keeps the stored secret when an edit leaves it out", () => {
    const { clientSecret: _omit, ...withoutSecret } = INPUT;
    const edited = mergeUberDirectInput(settingsExtra!, { ...withoutSecret, clientId: "client_new" });
    const config = resolveUberDirectConfig(edited);
    expect(config?.credentials).toEqual({ customerId: "cust_123", clientId: "client_new", clientSecret: "super-secret" });
  });

  it("gives the agent no delivery setup when switched off or removed", () => {
    expect(resolveUberDirectConfig(mergeUberDirectInput({}, { ...INPUT, enabled: false }))).toBeNull();
    expect(resolveUberDirectConfig(removeUberDirect(settingsExtra!))).toBeNull();
  });
});

describe("the delivery tools", () => {
  it("formats addresses the structured way Uber asks for", () => {
    expect(JSON.parse(formatUberAddress({ street: "Vesterbrogade 1", postalCode: "1620", city: "København V", country: "DK" }))).toEqual({
      street_address: ["Vesterbrogade 1"],
      city: "København V",
      state: "",
      zip_code: "1620",
      country: "DK",
    });
  });

  it("turns spoken Danish numbers into E.164", () => {
    expect(normalizePhone("12 34 56 78", "DK")).toBe("+4512345678");
    expect(normalizePhone("+46 70 123 45 67", "DK")).toBe("+46701234567");
    expect(normalizePhone("0045 12345678", "DK")).toBe("+4512345678");
    expect(normalizePhone("123", "DK")).toBeNull();
  });

  it("gets a quote with price and ETA, collecting from the business's own address", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 2592000 }))
      .mockResolvedValueOnce(jsonResponse({ id: "dqt_1", fee: 4900, currency: "dkk", dropoff_eta: "2026-09-22T20:30:00Z", duration: 35 }));

    const result = JSON.parse(
      await executeUberDirectTool(
        "uber_delivery_quote",
        { dropoff_street: "Nørrebrogade 10", dropoff_postal_code: "2200", dropoff_city: "København N" },
        "widget-a",
        "cust-a"
      )
    );

    expect(result).toMatchObject({ ok: true, quote_id: "dqt_1", price: "49.00 DKK", duration_minutes: 35 });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api.uber.com/v1/customers/cust_123/delivery_quotes");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(JSON.parse(body.pickup_address).street_address).toEqual(["Vesterbrogade 1"]);
    expect(JSON.parse(body.dropoff_address).zip_code).toBe("2200");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("refuses to create a delivery without a quote or a valid phone number", async () => {
    const base = {
      dropoff_street: "Nørrebrogade 10",
      dropoff_postal_code: "2200",
      dropoff_city: "København N",
      dropoff_name: "Anna",
      items: [{ name: "Kage", quantity: 1 }],
    };
    expect(JSON.parse(await executeUberDirectTool("uber_create_delivery", { ...base, dropoff_phone: "12345678" }, "widget-a", "cust-a"))).toEqual({
      ok: false,
      error: "missing_quote",
    });
    expect(
      JSON.parse(await executeUberDirectTool("uber_create_delivery", { ...base, quote_id: "dqt_1", dropoff_phone: "12" }, "widget-a", "cust-a"))
    ).toEqual({ ok: false, error: "invalid_phone" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the delivery, returns the tracking link and logs it for this agent", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 2592000 }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "del_1", status: "pending", fee: 4900, currency: "dkk", tracking_url: "https://track.uber.com/x" })
      );

    const result = JSON.parse(
      await executeUberDirectTool(
        "uber_create_delivery",
        {
          quote_id: "dqt_1",
          dropoff_street: "Nørrebrogade 10",
          dropoff_postal_code: "2200",
          dropoff_city: "København N",
          dropoff_name: "Anna",
          dropoff_phone: "12345678",
          items: [{ name: "Kage", quantity: 2 }],
          order_reference: "A-1001",
        },
        "widget-a",
        "cust-a"
      )
    );

    expect(result).toMatchObject({ ok: true, delivery_id: "del_1", tracking_url: "https://track.uber.com/x", price: "49.00 DKK" });
    const body = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(body).toMatchObject({ quote_id: "dqt_1", dropoff_phone_number: "+4512345678", pickup_name: "Bageriet", external_id: "A-1001" });
    expect(body.manifest_items).toEqual([{ name: "Kage", quantity: 2, size: "small" }]);
    expect(auditRows.at(-1)).toMatchObject({ action: "uber_direct.delivery_created", entity_id: "del_1" });
    expect((auditRows.at(-1)!.metadata as Record<string, unknown>).widgetId).toBe("widget-a");
  });

  it("only looks up deliveries this agent created", async () => {
    const result = JSON.parse(await executeUberDirectTool("uber_delivery_status", { delivery_id: "del_other" }, "widget-a", "cust-a"));
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finds a delivery by the shop's order number", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 2592000 }))
      .mockResolvedValueOnce(jsonResponse({ id: "del_ref", status: "pickup_complete", courier: { name: "Jonas", vehicle_type: "bicycle" } }));

    const result = JSON.parse(await executeUberDirectTool("uber_delivery_status", { order_reference: "A-1001" }, "widget-a", "cust-a"));

    expect(result).toMatchObject({ ok: true, delivery_id: "del_ref", status: "pickup_complete", courier: { name: "Jonas" } });
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.uber.com/v1/customers/cust_123/deliveries/del_ref");
  });

  it("answers honestly when the agent has no delivery setup", async () => {
    settingsExtra = {};
    expect(JSON.parse(await executeUberDirectTool("uber_delivery_quote", {}, "widget-a", "cust-a"))).toEqual({
      ok: false,
      error: "not_connected",
    });
  });

  it("turns an Uber error into something the agent can say, never a throw", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 2592000 }))
      .mockResolvedValueOnce(jsonResponse({ code: "address_undeliverable", message: "outside area" }, 400));

    const result = JSON.parse(
      await executeUberDirectTool(
        "uber_delivery_quote",
        { dropoff_street: "Langt væk 1", dropoff_postal_code: "9990", dropoff_city: "Skagen" },
        "widget-a",
        "cust-a"
      )
    );
    expect(result).toEqual({ ok: false, error: "address_undeliverable" });
  });
});

describe("the delivery status webhook", () => {
  function webhook(body: string, signature: string | null) {
    return new Request("https://example.dk/api/webhooks/uber-direct/widget-a", {
      method: "POST",
      headers: signature ? { "x-uber-signature": signature } : {},
      body,
    });
  }
  const body = JSON.stringify({
    kind: "event.delivery_status",
    status: "delivered",
    delivery_id: "del_1",
    data: { tracking_url: "https://track.uber.com/x" },
  });
  const sign = (text: string) => createHmac("sha256", "signing-key").update(text, "utf8").digest("hex");

  it("records a correctly signed status update", async () => {
    const res = await webhookPOST(webhook(body, sign(body)), { params: { widgetId: "widget-a" } });
    expect(res.status).toBe(200);
    expect(auditRows.at(-1)).toMatchObject({ action: "uber_direct.delivery_status", entity_id: "del_1" });
    expect((auditRows.at(-1)!.metadata as Record<string, unknown>).status).toBe("delivered");
  });

  it("rejects a forged or unsigned update", async () => {
    expect((await webhookPOST(webhook(body, sign("other")), { params: { widgetId: "widget-a" } })).status).toBe(401);
    expect((await webhookPOST(webhook(body, null), { params: { widgetId: "widget-a" } })).status).toBe(401);
    expect(auditRows).toHaveLength(0);
  });

  it("trusts nothing for an agent without a signing key", async () => {
    const { webhookSigningKey: _omit, ...noKey } = INPUT;
    settingsExtra = mergeUberDirectInput({}, noKey);
    const res = await webhookPOST(webhook(body, sign(body)), { params: { widgetId: "widget-a" } });
    expect(res.status).toBe(202);
    expect(auditRows).toHaveLength(0);
  });
});
