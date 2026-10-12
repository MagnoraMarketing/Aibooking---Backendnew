import { describe, it, expect, vi, beforeEach } from "vitest";

// Each agent has its own Vapi assistant, and that assistant is how calls,
// tool calls and billing find their way back to the right customer (see
// lib/vapi/assistant-owner.ts). A customer must not be able to point their
// agent at another assistant, and an admin must not be able to link one
// assistant to two agents.

interface Recorded {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
}

let recorded: Recorded[] = [];
// widget_settings rows, as { widget_id, extra }.
let settingsRows: { widget_id: string; extra: Record<string, unknown> }[] = [];

function settingsQuery() {
  const filters: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return chain;
    },
    upsert(payload: Record<string, unknown>) {
      recorded.push({ table: "widget_settings", op: "upsert", payload });
      return { error: null };
    },
    maybeSingle: async () => ({ data: settingsRows[0] ?? null, error: null }),
    then(resolve: (value: { data: unknown[]; error: null }) => void) {
      const data = settingsRows.filter((row) =>
        filters.every(([column, value]) => {
          const match = /^extra->>(.+)$/.exec(column);
          return match ? row.extra[match[1] as string] === value : true;
        })
      );
      resolve({ data, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table === "widget_settings") return settingsQuery();
      const chain = {
        select: () => chain,
        eq: () => chain,
        update(payload: Record<string, unknown>) {
          recorded.push({ table, op: "update", payload });
          return chain;
        },
        maybeSingle: async () => ({ data: { id: "widget-a", customer_id: "cust-a" }, error: null }),
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
const { assertAssistantNotLinkedElsewhere } = await import("@/lib/vapi/assistant-owner");
const { customerWidgetExtraSettingsSchema } = await import("@/lib/security/schemas");

function patch(body: Record<string, unknown>): Request {
  return new Request("https://example.dk/api/admin/widgets/widget-a", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  recorded = [];
  settingsRows = [
    { widget_id: "widget-a", extra: { vapiAssistantId: "asst_a" } },
    { widget_id: "widget-b", extra: { vapiAssistantId: "asst_b", vapiOutboundAssistantId: "asst_b_out" } },
  ];
});

describe("a customer's agent settings", () => {
  it("drop any assistant id the customer sends", () => {
    const parsed = customerWidgetExtraSettingsSchema.parse({
      vapiAssistantId: "asst_b",
      vapiOutboundAssistantId: "asst_b_out",
      voiceGender: "male",
    });

    expect(parsed).toEqual({ voiceGender: "male" });
  });
});

describe("linking an assistant to an agent", () => {
  it("is refused when another agent answers its phone with it", async () => {
    await expect(assertAssistantNotLinkedElsewhere("asst_b", "widget-a")).rejects.toMatchObject({ status: 409 });
  });

  it("is refused when another agent places its campaign calls with it", async () => {
    await expect(assertAssistantNotLinkedElsewhere("asst_b_out", "widget-a")).rejects.toMatchObject({ status: 409 });
  });

  it("is refused for a brand new agent too", async () => {
    await expect(assertAssistantNotLinkedElsewhere("asst_a", null)).rejects.toMatchObject({ status: 409 });
  });

  it("is allowed when the agent already has it", async () => {
    await expect(assertAssistantNotLinkedElsewhere("asst_a", "widget-a")).resolves.toBeUndefined();
  });

  it("is allowed when no agent has it", async () => {
    await expect(assertAssistantNotLinkedElsewhere("asst_new", "widget-a")).resolves.toBeUndefined();
  });

  it("from the admin area writes nothing when the assistant belongs to another agent", async () => {
    const res = await PATCH(patch({ extra: { vapiOutboundAssistantId: "asst_b" } }), { params: { id: "widget-a" } });

    expect(res.status).toBe(409);
    expect(recorded).toEqual([]);
  });

  it("from the admin area still saves an assistant no other agent uses", async () => {
    const res = await PATCH(patch({ extra: { vapiOutboundAssistantId: "asst_new" } }), { params: { id: "widget-a" } });

    expect(res.status).toBe(200);
    expect(recorded.find((row) => row.op === "upsert")?.payload?.extra).toMatchObject({
      vapiOutboundAssistantId: "asst_new",
    });
  });
});
