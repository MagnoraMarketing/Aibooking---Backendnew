import { describe, expect, it } from "vitest";
import { widgetUnavailableReason } from "@/lib/widgets/availability";

// The public lookup and the dashboard's health check both read this, so the
// owner is told exactly the reason the public "Widget not found" hides.
describe("widgetUnavailableReason", () => {
  it("is null for an active agent on an active account", () => {
    expect(widgetUnavailableReason({ status: "active" }, { status: "active" })).toBeNull();
  });

  it("reports a paused agent", () => {
    expect(widgetUnavailableReason({ status: "paused" }, { status: "active" })).toBe("widget_paused");
  });

  it("reports an inactive, deleted or missing account", () => {
    expect(widgetUnavailableReason({ status: "active" }, { status: "inactive" })).toBe("customer_inactive");
    expect(widgetUnavailableReason({ status: "active" }, { status: "deleted" })).toBe("customer_inactive");
    expect(widgetUnavailableReason({ status: "active" }, null)).toBe("customer_inactive");
  });
});
