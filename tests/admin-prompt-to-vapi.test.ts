import { describe, it, expect, vi, beforeEach } from "vitest";

// An agent's prompt is written in AIbooking's admin, not in Vapi's dashboard.
// Creating or editing an agent there must push that prompt onto its Vapi
// assistant — and an agent created without one must get one built from it.

let widgetRow: Record<string, unknown> | null = null;
let settingsRow: Record<string, unknown> | null = null;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        upsert: () => ({ error: null }),
        maybeSingle: async () => ({ data: table === "widgets" ? widgetRow : settingsRow, error: null }),
      };
      return chain;
    },
  }),
}));

const syncMock = vi.fn(async (..._args: unknown[]) => ({ status: "synced" as const }));
const ensureMock = vi.fn(async (_widgetId: string) => "asst_new");

vi.mock("@/lib/vapi", () => ({
  syncWidgetToVapiAssistant: (...args: unknown[]) => syncMock(...args),
  ensureVapiAssistant: (widgetId: string) => ensureMock(widgetId),
  refreshWapiAgent: vi.fn(),
  attachAssistantToVapiNumber: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireMasterAdmin: async () => ({ userId: "admin-1", profile: { role: "MASTER_ADMIN", customer_id: null } }),
}));

vi.mock("@/lib/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security")>();
  return { ...actual, writeAuditLog: async () => {} };
});

const { pushAdminWidgetToVapi } = await import("@/lib/admin/widget-service");
const { PATCH } = await import("@/app/api/admin/widgets/[id]/route");

function patch(body: Record<string, unknown>): Request {
  return new Request("https://example.dk/api/admin/widgets/widget-a", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  syncMock.mockClear().mockResolvedValue({ status: "synced" });
  ensureMock.mockClear().mockResolvedValue("asst_new");
  vi.spyOn(console, "error").mockImplementation(() => {});
  widgetRow = { id: "widget-a", customer_id: "cust-a", name: "Receptionen", system_prompt: "Du er receptionist." };
  settingsRow = { extra: { vapiAssistantId: "asst_existing" } };
});

describe("pushing an admin agent's prompt to Vapi", () => {
  it("syncs the agent onto the Vapi assistant it already has", async () => {
    const outcome = await pushAdminWidgetToVapi("widget-a");

    expect(outcome).toEqual({ status: "synced" });
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock.mock.calls[0]![0]).toMatchObject({ system_prompt: "Du er receptionist." });
    expect(syncMock.mock.calls[0]![1]).toMatchObject({ vapiAssistantId: "asst_existing" });
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("builds a new assistant from the prompt when creating an agent without one", async () => {
    settingsRow = { extra: {} };

    const outcome = await pushAdminWidgetToVapi("widget-a", { createIfMissing: true });

    expect(outcome).toEqual({ status: "synced" });
    expect(ensureMock).toHaveBeenCalledWith("widget-a");
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("never creates an assistant for an existing agent that has none", async () => {
    settingsRow = { extra: {} };

    const outcome = await pushAdminWidgetToVapi("widget-a");

    expect(outcome).toEqual({ status: "skipped", reason: "no_vapi_assistant" });
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("reports a Vapi failure instead of throwing, so the saved agent survives", async () => {
    syncMock.mockRejectedValueOnce(new Error("Vapi afviste anmodningen (500)"));

    const outcome = await pushAdminWidgetToVapi("widget-a");

    expect(outcome).toEqual({ status: "failed", error: "Vapi afviste anmodningen (500)" });
  });
});

describe("editing an agent in the admin area", () => {
  it("pushes the new prompt to Vapi and reports it", async () => {
    const res = await PATCH(patch({ systemPrompt: "Ny prompt" }), { params: { id: "widget-a" } });

    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { vapiSync: unknown };
    expect(body.vapiSync).toEqual({ status: "synced" });
  });

  it("still saves when Vapi is down, and says so", async () => {
    syncMock.mockRejectedValueOnce(new Error("timeout"));

    const res = await PATCH(patch({ systemPrompt: "Ny prompt" }), { params: { id: "widget-a" } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { vapiSync: { status: string } };
    expect(body.vapiSync.status).toBe("failed");
  });
});
