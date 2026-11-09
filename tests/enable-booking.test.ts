import { describe, it, expect, vi, beforeEach } from "vitest";

const syncWidgetToVapiAssistant = vi.fn();
vi.mock("@/lib/vapi/sync", () => ({
  syncWidgetToVapiAssistant: (...args: unknown[]) => syncWidgetToVapiAssistant(...args),
}));

const updates: Record<string, unknown>[] = [];
let updateResult: { data: unknown; error: unknown };
vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) =>
      table === "widgets"
        ? {
            update: (values: Record<string, unknown>) => {
              updates.push(values);
              return { eq: () => ({ select: () => ({ single: async () => updateResult }) }) };
            },
          }
        : {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { extra: { vapiAssistantId: "asst-1" } } }) }) }),
          },
  }),
}));

import { enableBookingForWidget } from "@/lib/vapi/enable-booking";

describe("enableBookingForWidget (Google/Outlook connect)", () => {
  beforeEach(() => {
    updates.length = 0;
    syncWidgetToVapiAssistant.mockReset().mockResolvedValue({ status: "synced" });
    updateResult = { data: { id: "w1", booking_enabled: true }, error: null };
  });

  it("turns booking on and syncs the assistant so it gets the booking tools", async () => {
    await enableBookingForWidget("w1");
    expect(updates).toEqual([{ booking_enabled: true }]);
    expect(syncWidgetToVapiAssistant).toHaveBeenCalledWith(
      { id: "w1", booking_enabled: true },
      { vapiAssistantId: "asst-1" }
    );
  });

  it("does not sync when the widget update fails", async () => {
    updateResult = { data: null, error: new Error("db down") };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await enableBookingForWidget("w1");
    expect(syncWidgetToVapiAssistant).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("never throws, so the OAuth callback still redirects as connected", async () => {
    syncWidgetToVapiAssistant.mockRejectedValue(new Error("Vapi down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(enableBookingForWidget("w1")).resolves.toBeUndefined();
    errors.mockRestore();
  });
});
