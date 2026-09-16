import { describe, it, expect, vi, beforeEach } from "vitest";

// A platform-level change — a replaced voice template, a new default prompt
// — only reaches an assistant the next time its own widget is edited. For a
// widget nobody touches, that is never. This is the admin button that closes
// that gap, so what matters is that it reaches EVERY assistant and reports
// honestly which ones it could not.

interface WidgetRow {
  widget_id: string;
  extra: Record<string, unknown>;
  widgets: { id: string; name: string } | null;
}

let settingsRows: WidgetRow[] = [];
let auditEntries: Array<Record<string, unknown>> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: async () => ({ data: settingsRows, error: null }),
    }),
  }),
}));

vi.mock("@/lib/auth", () => ({
  requireMasterAdmin: async () => ({ userId: "admin-1", profile: { role: "MASTER_ADMIN" } }),
}));

const syncMock = vi.fn();
vi.mock("@/lib/vapi", () => ({
  syncWidgetToVapiAssistant: (...args: unknown[]) => syncMock(...args),
}));

vi.mock("@/lib/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security")>();
  return {
    ...actual,
    writeAuditLog: async (entry: Record<string, unknown>) => {
      auditEntries.push(entry);
    },
  };
});

const { POST } = await import("@/app/api/admin/vapi/resync/route");

function widget(id: string, name: string, assistantId: string | null): WidgetRow {
  return {
    widget_id: id,
    extra: assistantId ? { vapiAssistantId: assistantId } : {},
    widgets: { id, name },
  };
}

async function resync() {
  const res = await POST(new Request("https://example.dk/api/admin/vapi/resync", { method: "POST" }), { params: {} });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  auditEntries = [];
  syncMock.mockReset();
  syncMock.mockResolvedValue({ status: "synced" });
  settingsRows = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("re-syncing every Vapi assistant from admin", () => {
  it("syncs every widget that has an assistant, not just the first page of them", async () => {
    // More than one concurrency batch: an off-by-one in the batching loop
    // would silently leave the tail of the estate on the old voice, which is
    // exactly the failure this button exists to prevent.
    settingsRows = Array.from({ length: 12 }, (_, i) => widget(`w-${i}`, `Agent ${i}`, `asst_${i}`));

    const { status, body } = await resync();

    expect(status).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(12);
    expect(body).toMatchObject({ total: 12, synced: 12, failed: 0 });
  });

  it("leaves widgets with no Vapi assistant alone", async () => {
    settingsRows = [widget("w-1", "Chat-agent", null), widget("w-2", "Stemme-agent", "asst_2")];

    const { body } = await resync();

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(body.total).toBe(1);
  });

  it("reports which agents failed instead of stopping at the first one", async () => {
    settingsRows = [widget("w-1", "Frisøren", "asst_1"), widget("w-2", "Tandlægen", "asst_2"), widget("w-3", "Klinikken", "asst_3")];
    syncMock.mockImplementation(async (w: { id: string }) =>
      w.id === "w-2" ? { status: "failed", error: "Vapi afviste anmodningen (400)" } : { status: "synced" }
    );

    const { body } = await resync();

    expect(body).toMatchObject({ total: 3, synced: 2, failed: 1 });
    expect(body.failures).toEqual([
      { widgetId: "w-2", name: "Tandlægen", status: "failed", detail: "Vapi afviste anmodningen (400)" },
    ]);
  });

  it("survives a sync that throws rather than returning an outcome", async () => {
    settingsRows = [widget("w-1", "Frisøren", "asst_1"), widget("w-2", "Tandlægen", "asst_2")];
    syncMock.mockImplementation(async (w: { id: string }) => {
      if (w.id === "w-1") throw new Error("database unreachable");
      return { status: "synced" };
    });

    const { status, body } = await resync();

    expect(status).toBe(200);
    expect(body).toMatchObject({ synced: 1, failed: 1 });
    expect(body.failures[0]).toMatchObject({ name: "Frisøren", detail: "database unreachable" });
  });

  it("records the run in the audit log", async () => {
    settingsRows = [widget("w-1", "Frisøren", "asst_1")];

    await resync();

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      action: "vapi_assistants.resynced",
      metadata: { total: 1, synced: 1, failed: 0 },
    });
  });
});

// The bulk re-sync above trusts syncWidgetToVapiAssistant's outcome to tell
// it what happened. Before this, that function returned void and swallowed
// every Vapi error, so a run could report 30 successes having achieved
// nothing. These pin the outcome itself.
describe("what one sync reports back", () => {
  it("reports failed, with the reason, when Vapi rejects the update", async () => {
    vi.resetModules();

    vi.doMock("@/lib/database/admin", () => ({
      getAdminClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { provider: "vapi" } }) }) }),
        }),
      }),
    }));
    vi.doMock("@/lib/settings/platform", () => ({ getDefaultSystemPrompt: async () => "prompt" }));
    vi.doMock("@/lib/shopify/agent-tools", () => ({ resolveShopifyCapabilities: async () => ({}) }));
    vi.doMock("@/lib/shopify/tool-definitions", () => ({ buildShopifyVapiTools: () => [] }));
    vi.doMock("@/lib/vapi/assistants", () => ({
      updateVapiAssistant: async () => {
        throw new Error("Vapi afviste anmodningen (400)");
      },
    }));

    const { syncWidgetToVapiAssistant } = await import("@/lib/vapi/sync");
    const widgetRow = { id: "w-1", name: "Frisøren", llm_model_id: "llm-1", language: "da" } as never;

    const outcome = await syncWidgetToVapiAssistant(widgetRow, { vapiAssistantId: "asst_1" });

    expect(outcome).toEqual({ status: "failed", error: "Vapi afviste anmodningen (400)" });
    vi.resetModules();
  });

  it("reports skipped — not synced — for a widget with no Vapi assistant", async () => {
    vi.resetModules();
    vi.doMock("@/lib/settings/platform", () => ({ getDefaultSystemPrompt: async () => "prompt" }));

    const { syncWidgetToVapiAssistant } = await import("@/lib/vapi/sync");
    const widgetRow = { id: "w-1", name: "Chat-agent", llm_model_id: "llm-1", language: "da" } as never;

    expect(await syncWidgetToVapiAssistant(widgetRow, {})).toEqual({
      status: "skipped",
      reason: "no_vapi_assistant",
    });
    vi.resetModules();
  });
});
