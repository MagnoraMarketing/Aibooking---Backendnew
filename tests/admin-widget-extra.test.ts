import { describe, it, expect, vi, beforeEach } from "vitest";

// An agent's outbound assistant lives in widget_settings.extra, which the
// customer dashboard could already edit and support could not — so setting it
// for a customer meant opening a database console. This is the same edit,
// through the admin API.

interface Recorded {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
}

let recorded: Recorded[] = [];
let widgetRow: Record<string, unknown> | null = null;
let settingsRow: Record<string, unknown> | null = null;

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
          return { error: null };
        },
        maybeSingle: async () => ({ data: table === "widgets" ? widgetRow : settingsRow, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/auth", () => ({
  requireMasterAdmin: async () => ({ userId: "admin-1", profile: { role: "MASTER_ADMIN", customer_id: null } }),
}));

vi.mock("@/lib/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security")>();
  return { ...actual, writeAuditLog: async () => {} };
});

const { PATCH } = await import("@/app/api/admin/widgets/[id]/route");

function patch(body: Record<string, unknown>): Request {
  return new Request("https://example.dk/api/admin/widgets/widget-a", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function upsertedExtra(): Record<string, unknown> | undefined {
  return recorded.find((row) => row.table === "widget_settings" && row.op === "upsert")?.payload?.extra as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  recorded = [];
  widgetRow = { id: "widget-a", customer_id: "cust-a", name: "Frisørstuen" };
  settingsRow = { extra: { vapiAssistantId: "asst_inbound", knowledgeBase: [{ title: "Priser" }] } };
});

describe("editing an agent's settings from the admin area", () => {
  it("stores the outbound assistant an admin typed", async () => {
    const res = await PATCH(patch({ extra: { vapiOutboundAssistantId: "asst_outbound" } }), {
      params: { id: "widget-a" },
    });

    expect(res.status).toBe(200);
    expect(upsertedExtra()).toMatchObject({ vapiOutboundAssistantId: "asst_outbound" });
  });

  // Every tab's settings share one jsonb blob. Replacing it wholesale would
  // take the knowledge base with it.
  it("merges into the existing settings rather than replacing them", async () => {
    await PATCH(patch({ extra: { vapiOutboundAssistantId: "asst_outbound" } }), { params: { id: "widget-a" } });

    expect(upsertedExtra()).toMatchObject({
      vapiAssistantId: "asst_inbound",
      knowledgeBase: [{ title: "Priser" }],
    });
  });

  // Clearing the field puts campaigns back on the assistant that answers the
  // phone — see outboundAssistantId in lib/vapi/assistant-owner.ts.
  it("lets an admin clear it again", async () => {
    await PATCH(patch({ extra: { vapiOutboundAssistantId: null } }), { params: { id: "widget-a" } });

    expect(upsertedExtra()).toMatchObject({ vapiOutboundAssistantId: null });
  });

  // An UPDATE with no columns is not a no-op in PostgREST, it is an error.
  it("does not write an empty update when only the settings changed", async () => {
    await PATCH(patch({ extra: { vapiOutboundAssistantId: "asst_outbound" } }), { params: { id: "widget-a" } });

    expect(recorded.some((row) => row.table === "widgets" && row.op === "update")).toBe(false);
  });

  it("still updates the widget's own columns when those are what changed", async () => {
    await PATCH(patch({ status: "paused" }), { params: { id: "widget-a" } });

    expect(recorded).toContainEqual({ table: "widgets", op: "update", payload: { status: "paused" } });
    expect(recorded.some((row) => row.table === "widget_settings")).toBe(false);
  });

  it("404s on a widget that does not exist instead of writing its settings", async () => {
    widgetRow = null;

    const res = await PATCH(patch({ extra: { vapiOutboundAssistantId: "asst_outbound" } }), {
      params: { id: "widget-a" },
    });

    expect(res.status).toBe(404);
    expect(recorded.some((row) => row.table === "widget_settings")).toBe(false);
  });
});
