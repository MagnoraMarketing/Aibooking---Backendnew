import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WidgetBundle } from "@/lib/widgets";

// The internal credit ledger gates every widget session on a balance that,
// for AIbooking's own reserved is_platform_owned customer (its own website
// widgets), only ever grows via a manual admin top-up — there's no Stripe
// subscription to auto-recharge it. In Vapi mode that gate is redundant:
// Vapi bills our account directly for the call regardless of the internal
// balance, so the site's own demo widget should keep working off Vapi's own
// credit even while the internal balance sits at zero. See the comment in
// app/api/widget/session/route.ts this test exercises.

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

let idCounter = 0;
function fakeUuid(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

function matches(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

function makeQuery(table: string) {
  const filters: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    insert: (payload: Row) => {
      const row = { id: payload.id ?? fakeUuid(), created_at: new Date().toISOString(), ...payload };
      tables[table] = [...(tables[table] ?? []), row];
      return {
        select: () => ({
          single: async () => ({ data: row, error: null }),
        }),
      };
    },
    update: (patch: Row) => {
      for (const row of tables[table] ?? []) {
        if (matches(row, filters)) Object.assign(row, patch);
      }
      return chain;
    },
  };
  return chain;
}

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({ from: (table: string) => makeQuery(table) }),
}));

const checkAndRefillIfNeededMock = vi.fn();
vi.mock("@/lib/credits", () => ({
  checkAndRefillIfNeeded: (...args: unknown[]) => checkAndRefillIfNeededMock(...args),
}));

vi.mock("@/lib/usage", () => ({
  createUsageSession: async (params: Record<string, unknown>) => ({ id: fakeUuid(), ...params }),
  finalizeUsageSession: async (id: string) => ({ id, billed_duration_seconds: 1 }),
  setUsageSessionDuration: async () => {},
}));

vi.mock("@/lib/vapi", () => ({
  getVapiCallConfig: (assistantId: string | null) => {
    if (!assistantId) throw new Error("missing assistant id");
    return { publicKey: "pk_test", assistantId };
  },
}));

let widgetBundle: WidgetBundle | null = null;
vi.mock("@/lib/widgets", () => ({
  getWidgetBundleByPublicId: async () => widgetBundle,
}));

import { POST as postSession } from "@/app/api/widget/session/route";

function sessionRequest() {
  return new Request("https://app.test/api/widget/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "https://www.aibooking.dk" },
    body: JSON.stringify({ publicId: "pub-1" }),
  });
}

function makeBundle(overrides: { isPlatformOwned: boolean; provider: "vapi" | "anthropic" }): WidgetBundle {
  return {
    widget: { id: "widget-1", customer_id: "cust-1" } as WidgetBundle["widget"],
    customer: { id: "cust-1", status: "active", is_platform_owned: overrides.isPlatformOwned } as WidgetBundle["customer"],
    llmModel: { provider: overrides.provider } as WidgetBundle["llmModel"],
    voiceModel: overrides.provider === "vapi" ? null : ({ id: "voice-1" } as WidgetBundle["voiceModel"]),
    extra: overrides.provider === "vapi" ? { vapiAssistantId: "asst-1" } : {},
  };
}

describe("widget session start — internal credit gate", () => {
  beforeEach(() => {
    idCounter = 0;
    tables.conversations = [];
    checkAndRefillIfNeededMock.mockReset();
  });

  it("still gates a paying customer's Vapi widget on the internal balance", async () => {
    widgetBundle = makeBundle({ isPlatformOwned: false, provider: "vapi" });
    checkAndRefillIfNeededMock.mockResolvedValue({ balanceSeconds: 0, refilled: false });

    const res = await postSession(sessionRequest(), { params: {} });

    expect(res.status).toBe(402);
    expect(checkAndRefillIfNeededMock).toHaveBeenCalledWith("cust-1");
  });

  it("still gates the platform-owned customer's widget when it is not in Vapi mode", async () => {
    widgetBundle = makeBundle({ isPlatformOwned: true, provider: "anthropic" });
    checkAndRefillIfNeededMock.mockResolvedValue({ balanceSeconds: 0, refilled: false });

    const res = await postSession(sessionRequest(), { params: {} });

    expect(res.status).toBe(402);
    expect(checkAndRefillIfNeededMock).toHaveBeenCalledWith("cust-1");
  });

  it("lets the platform-owned customer's Vapi widget start with zero internal balance — Vapi bills directly", async () => {
    widgetBundle = makeBundle({ isPlatformOwned: true, provider: "vapi" });
    checkAndRefillIfNeededMock.mockResolvedValue({ balanceSeconds: 0, refilled: false });

    const res = await postSession(sessionRequest(), { params: {} });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.mode).toBe("vapi");
    expect(body.vapi).toMatchObject({ publicKey: "pk_test", assistantId: "asst-1" });
    expect(checkAndRefillIfNeededMock).not.toHaveBeenCalled();
  });
});
