import type { Customer, Widget } from "@/types/database";

// Why an agent can or cannot be reached from a website. One answer shared by
// the public lookup (lib/widgets/lookup.ts — which still shows every
// unavailable case to the end user as the same "Widget not found") and the
// dashboard's own check (app/api/customer/widgets/[id]/health), which tells
// the owner which case it is and how to fix it. Kept in one place so the two
// can never disagree about whether an agent is live.
export type WidgetUnavailableReason = "widget_paused" | "customer_inactive";

export function widgetUnavailableReason(
  widget: Pick<Widget, "status">,
  customer: Pick<Customer, "status"> | null
): WidgetUnavailableReason | null {
  if (widget.status !== "active") return "widget_paused";
  if (!customer || customer.status !== "active") return "customer_inactive";
  return null;
}
