import { describe, it, expect, vi, beforeEach } from "vitest";

// Phone agents created before inbound moved to Vapi run on the Anthropic
// model and have no assistant — and nothing in the dashboard can give them
// one: the model picker is gone, and the PATCH route's self-heal only fires
// for agents already on the Vapi model. Requiring an assistant for an inbound
// number therefore stranded exactly the agents the Inbound page offers, with
// an error telling the customer to do something that would not have helped.

const createVapiAssistant = vi.fn(async (..._args: unknown[]) => ({ id: "asst_new" }));
const syncWidgetToVapiAssistant = vi.fn(async () => ({ status: "synced" as const }));

vi.mock("@/lib/vapi/assistants", () => ({
  createVapiAssistant: (...args: unknown[]) => createVapiAssistant(...(args as [])),
}));
vi.mock("@/lib/vapi/sync", () => ({
  syncWidgetToVapiAssistant: (...args: unknown[]) => syncWidgetToVapiAssistant(...(args as [])),
}));
vi.mock("@/lib/settings/platform", () => ({
  getDefaultSystemPrompt: async () => "Du er receptionist.",
}));

let widget: Record<string, unknown>;
let extra: Record<string, unknown> | null;
let vapiModelRow: Record<string, unknown> | null;
const widgetUpdates: Array<Record<string, unknown>> = [];
const settingsUpserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "widgets") {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: widget, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            widgetUpdates.push(patch);
            Object.assign(widget, patch);
            return { eq: () => ({ select: () => ({ single: async () => ({ data: widget }) }) }) };
          },
        };
      }
      if (table === "widget_settings") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: extra ? { extra } : null }) }) }),
          upsert: async (row: Record<string, unknown>) => {
            settingsUpserts.push(row);
            extra = row.extra as Record<string, unknown>;
            return { error: null };
          },
        };
      }
      if (table === "llm_models") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => ({ data: vapiModelRow }),
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { ensureInboundAssistant } from "@/lib/vapi/ensure-assistant";

beforeEach(() => {
  createVapiAssistant.mockClear();
  syncWidgetToVapiAssistant.mockClear();
  widgetUpdates.length = 0;
  settingsUpserts.length = 0;
  widget = {
    id: "widget-1",
    name: "Frisørstuen",
    language: "da",
    system_prompt: "Du er receptionist for Frisørstuen.",
    opening_message: null,
    llm_model_id: "anthropic-model",
  };
  extra = {};
  vapiModelRow = { id: "vapi-model" };
});

describe("an older phone agent given an inbound number", () => {
  it("gets an assistant and moves onto the Vapi model", async () => {
    const assistantId = await ensureInboundAssistant("widget-1");

    expect(assistantId).toBe("asst_new");
    expect(createVapiAssistant).toHaveBeenCalledTimes(1);
    expect(widgetUpdates).toEqual([{ llm_model_id: "vapi-model" }]);
    expect(settingsUpserts[0]!.extra).toMatchObject({ vapiAssistantId: "asst_new" });
  });

  // The assistant is built from the bare prompt; only the sync merges in the
  // knowledge base and the booking tools. Without it the agent answers its
  // first call knowing none of its own sources.
  it("syncs the knowledge base and tools onto the new assistant", async () => {
    await ensureInboundAssistant("widget-1");

    expect(syncWidgetToVapiAssistant).toHaveBeenCalledTimes(1);
    const [syncedWidget, syncedExtra] = syncWidgetToVapiAssistant.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(syncedWidget.llm_model_id).toBe("vapi-model");
    expect(syncedExtra.vapiAssistantId).toBe("asst_new");
  });

  it("speaks the agent's own language, not the platform default", async () => {
    widget.language = "de";

    await ensureInboundAssistant("widget-1");

    const params = createVapiAssistant.mock.calls[0]![0] as { language: string; firstMessage: string };
    expect(params.language).toBe("de");
    expect(params.firstMessage).toContain("Hallo");
  });
});

describe("an agent that already has an assistant", () => {
  it("is left exactly as it is", async () => {
    extra = { vapiAssistantId: "asst_existing" };

    const assistantId = await ensureInboundAssistant("widget-1");

    expect(assistantId).toBe("asst_existing");
    expect(createVapiAssistant).not.toHaveBeenCalled();
    expect(widgetUpdates).toEqual([]);
  });
});

describe("when the platform itself is not set up", () => {
  // Not the customer's problem to solve, so it must not read like their
  // mistake — and it must not leave a half-converted agent behind.
  it("fails without touching the agent when there is no Vapi model", async () => {
    vapiModelRow = null;

    await expect(ensureInboundAssistant("widget-1")).rejects.toThrow(/Vapi-model/);
    expect(createVapiAssistant).not.toHaveBeenCalled();
    expect(widgetUpdates).toEqual([]);
  });
});
