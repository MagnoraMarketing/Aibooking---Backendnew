import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Widget } from "@/types/database";

// widgets.booking_enabled is meant to be the single gate for booking across
// both pipelines — the Vapi tools (covered in booking-tools.test.ts) and the
// Anthropic tool-use loop covered here. These assert the Anthropic side can't
// drift back to "a connected calendar is enough".

let connection: Record<string, unknown> | null = null;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: connection, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/security", () => ({ decryptSecret: (v: string) => `decrypted:${v}` }));

import { resolveCalendarToolContext } from "@/lib/conversation/handle-turn";

const CONNECTED = {
  calcom_api_key: "cipher",
  calcom_event_type_id: "42",
  calcom_timezone: "Europe/Copenhagen",
};

function widget(overrides: Partial<Widget> = {}): Widget {
  return { id: "widget-a", booking_enabled: true, ...overrides } as Widget;
}

function params(w: Widget) {
  return {
    widget: w,
    customerId: "cust-a",
    conversationId: "conv-a",
  } as Parameters<typeof resolveCalendarToolContext>[0];
}

beforeEach(() => {
  connection = CONNECTED;
});

describe("booking gate on the Anthropic pipeline", () => {
  it("gives the agent calendar tools when booking is enabled", async () => {
    const ctx = await resolveCalendarToolContext(params(widget()));

    expect(ctx).toMatchObject({ eventTypeId: 42, apiKey: "decrypted:cipher" });
  });

  it("withholds them when booking is not enabled, even with a connected calendar", async () => {
    const ctx = await resolveCalendarToolContext(params(widget({ booking_enabled: false })));

    expect(ctx).toBeNull();
  });

  it("withholds them when booking is enabled but no calendar is connected", async () => {
    connection = null;

    expect(await resolveCalendarToolContext(params(widget()))).toBeNull();
  });

  it("withholds them when the stored event type is not a number", async () => {
    connection = { ...CONNECTED, calcom_event_type_id: "ikke-et-tal" };

    expect(await resolveCalendarToolContext(params(widget()))).toBeNull();
  });
});
