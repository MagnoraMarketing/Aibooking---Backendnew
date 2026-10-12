import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/auth/session";

// Every agent a customer creates gets a Vapi assistant of its own, editing
// an agent updates that same assistant and no other, and no customer can
// reach another customer's agent or assistant. Runs the real customer routes
// and auth guards against an in-memory database and a recorded Vapi API.

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let vapiCalls: { method: string; path: string; body: Record<string, unknown> | null }[];
let failVapiCreate: boolean;
let failSettingsInsert: boolean;
let nextAssistant: number;
let currentUser: AuthContext | null;

function query(table: string) {
  const filters: [string, unknown][] = [];
  let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  let payload: Row | null = null;
  const rows = () => (tables[table] ??= []);
  const matches = (row: Row) => filters.every(([column, value]) => row[column] === value);

  function run(): { data: Row[]; error: unknown } {
    if (op === "insert" && table === "widget_settings" && failSettingsInsert) {
      return { data: [], error: new Error("database unavailable") };
    }
    if (op === "insert") {
      const row = { id: `${table}-${rows().length + 1}`, ...payload } as Row;
      rows().push(row);
      return { data: [row], error: null };
    }
    if (op === "upsert") {
      const existing = rows().find((row) => row.widget_id === payload!.widget_id);
      if (existing) Object.assign(existing, payload);
      else rows().push({ ...payload });
      return { data: [], error: null };
    }
    const hits = rows().filter(matches);
    if (op === "update") hits.forEach((row) => Object.assign(row, payload));
    if (op === "delete") tables[table] = rows().filter((row) => !matches(row));
    return { data: hits.map((row) => ({ ...row })), error: null };
  }

  const chain = {
    select: () => chain,
    order: () => chain,
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return chain;
    },
    insert(value: Row) {
      op = "insert";
      payload = value;
      return chain;
    },
    update(value: Row) {
      op = "update";
      payload = value;
      return chain;
    },
    upsert(value: Row) {
      op = "upsert";
      payload = value;
      return chain;
    },
    delete() {
      op = "delete";
      return chain;
    },
    single: async () => ({ data: run().data[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    then(resolve: (value: { data: Row[]; error: unknown }) => void) {
      resolve(run());
    },
  };
  return chain;
}

vi.mock("@/lib/database/admin", () => ({ getAdminClient: () => ({ from: query }) }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: async () => currentUser }));
vi.mock("@/lib/settings/platform", () => ({
  getDefaultSystemPrompt: async () => "Standardprompt",
  getVapiVoiceTemplateAssistantId: async () => null,
}));
vi.mock("@/lib/shopify/agent-tools", () => ({ resolveShopifyCapabilities: async () => ({}) }));
vi.mock("@/lib/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security")>();
  return { ...actual, writeAuditLog: async () => {} };
});
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: async (path: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    vapiCalls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : null });
    if (method === "POST" && path === "/assistant") {
      if (failVapiCreate) throw new Error("Vapi afviste anmodningen (500): down");
      return new Response(JSON.stringify({ id: `asst_${++nextAssistant}` }));
    }
    return new Response("{}");
  },
}));

const { POST } = await import("@/app/api/customer/widgets/route");
const { PATCH } = await import("@/app/api/customer/widgets/[id]/route");

function signIn(customerId: string) {
  currentUser = {
    userId: `user-${customerId}`,
    email: `${customerId}@example.com`,
    profile: {
      id: `user-${customerId}`,
      role: "CUSTOMER_ADMIN",
      customer_id: customerId,
      full_name: null,
      language: "da",
      created_at: "",
      updated_at: "",
    },
  } as AuthContext;
}

function json(method: string, body: Record<string, unknown>): Request {
  return new Request("https://example.dk/api/customer/widgets", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createAgent(customerId: string, systemPrompt: string) {
  signIn(customerId);
  const res = await POST(json("POST", { name: `Agent ${customerId}`, systemPrompt, llmModelId: VAPI_MODEL }), {
    params: {},
  });
  return { res, body: (await res.json()) as { widget?: Row & { id: string }; error?: { message: string } } };
}

function assistantOf(widgetId: unknown): unknown {
  const settings = tables.widget_settings!.find((row) => row.widget_id === widgetId);
  return (settings?.extra as Row | undefined)?.vapiAssistantId;
}

const VAPI_MODEL = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  tables = { llm_models: [{ id: VAPI_MODEL, provider: "vapi", active: true }], widgets: [], widget_settings: [] };
  vapiCalls = [];
  failVapiCreate = false;
  failSettingsInsert = false;
  nextAssistant = 0;
  currentUser = null;
});

describe("one Vapi assistant per agent", () => {
  it("gives agents of different customers different assistants (tests 1 and 2)", async () => {
    const a = await createAgent("cust-a", "Du er receptionist hos Hansen Klinik");
    const b = await createAgent("cust-b", "Du er receptionist hos Jensen Tandlæge");

    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(201);
    expect(assistantOf(a.body.widget!.id)).toBe("asst_1");
    expect(assistantOf(b.body.widget!.id)).toBe("asst_2");
    expect(assistantOf(a.body.widget!.id)).not.toBe(assistantOf(b.body.widget!.id));
  });

  it("builds each assistant from its own agent's prompt", async () => {
    await createAgent("cust-a", "Du er receptionist hos Hansen Klinik");
    await createAgent("cust-b", "Du er receptionist hos Jensen Tandlæge");

    const prompts = vapiCalls
      .filter((call) => call.method === "POST")
      .map((call) => JSON.stringify(call.body));
    expect(prompts[0]).toContain("Hansen Klinik");
    expect(prompts[0]).not.toContain("Jensen Tandlæge");
    expect(prompts[1]).toContain("Jensen Tandlæge");
    expect(prompts[1]).not.toContain("Hansen Klinik");
  });

  it("updates only the editing customer's own assistant, and never creates a new one (tests 3, 4 and 6)", async () => {
    const a = await createAgent("cust-a", "Gammelt script A");
    const b = await createAgent("cust-b", "Gammelt script B");
    vapiCalls = [];

    signIn("cust-a");
    const resA = await PATCH(json("PATCH", { systemPrompt: "Nyt script A" }), { params: { id: a.body.widget!.id } });
    expect(resA.status).toBe(200);
    expect(vapiCalls).toHaveLength(1);
    expect(vapiCalls[0]).toMatchObject({ method: "PATCH", path: "/assistant/asst_1" });
    expect(JSON.stringify(vapiCalls[0]!.body)).toContain("Nyt script A");
    expect(assistantOf(a.body.widget!.id)).toBe("asst_1");

    vapiCalls = [];
    signIn("cust-b");
    const resB = await PATCH(json("PATCH", { systemPrompt: "Nyt script B" }), { params: { id: b.body.widget!.id } });
    expect(resB.status).toBe(200);
    expect(vapiCalls).toHaveLength(1);
    expect(vapiCalls[0]).toMatchObject({ method: "PATCH", path: "/assistant/asst_2" });
    expect(assistantOf(b.body.widget!.id)).toBe("asst_2");
  });

  it("refuses a customer editing another customer's agent (test 5)", async () => {
    const b = await createAgent("cust-b", "Script B");
    vapiCalls = [];

    signIn("cust-a");
    const res = await PATCH(json("PATCH", { systemPrompt: "Overtaget" }), { params: { id: b.body.widget!.id } });

    expect(res.status).toBe(404);
    expect(vapiCalls).toEqual([]);
    expect(tables.widgets!.find((row) => row.id === b.body.widget!.id)?.system_prompt).toBe("Script B");
  });

  it("ignores an assistant id a customer tries to set on their own agent", async () => {
    const a = await createAgent("cust-a", "Script A");
    await createAgent("cust-b", "Script B");
    vapiCalls = [];

    signIn("cust-a");
    await PATCH(json("PATCH", { systemPrompt: "Ny", extra: { vapiAssistantId: "asst_2" } }), {
      params: { id: a.body.widget!.id },
    });

    expect(assistantOf(a.body.widget!.id)).toBe("asst_1");
    expect(vapiCalls.every((call) => call.path !== "/assistant/asst_2")).toBe(true);
  });

  it("saves no agent when Vapi fails to create its assistant (test 7)", async () => {
    failVapiCreate = true;
    const { res, body } = await createAgent("cust-a", "Script A");

    expect(res.status).toBe(502);
    expect(body.error?.message).toMatch(/prøv igen/);
    expect(tables.widgets).toEqual([]);
    expect(tables.widget_settings).toEqual([]);
  });

  it("can simply be retried after Vapi failed", async () => {
    failVapiCreate = true;
    await createAgent("cust-a", "Script A");
    failVapiCreate = false;
    const { res, body } = await createAgent("cust-a", "Script A");

    expect(res.status).toBe(201);
    expect(tables.widgets).toHaveLength(1);
    expect(assistantOf(body.widget!.id)).toBe("asst_1");
  });

  it("removes the new assistant again when the agent itself cannot be saved", async () => {
    failSettingsInsert = true;
    const { res } = await createAgent("cust-a", "Script A");

    expect(res.status).toBe(500);
    expect(tables.widgets).toEqual([]);
    expect(vapiCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /assistant",
      "DELETE /assistant/asst_1",
    ]);
  });
});
