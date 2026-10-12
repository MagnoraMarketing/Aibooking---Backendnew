import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { grantCredits } from "@/lib/credits/ledger";
import { writeAuditLog } from "@/lib/security/audit";
import { notifyCustomerPayment } from "@/lib/email/internal-notifications";
import { WIDGET_LAUNCH_MINUTES, WIDGET_LAUNCH_SECONDS } from "./widget-launch-offer";
import type { Customer } from "@/types/database";

// Server-only half of the Voice Widget launch offer — the part that moves
// money-backed minutes onto a customer's ledger. Everything the browser also
// needs (minute count, payment link, client_reference_id shape) lives in
// ./widget-launch-offer.ts and is re-exported here so server callers still
// have a single import.
export * from "./widget-launch-offer";

export interface WidgetLaunchGrantResult {
  granted: boolean;
  reason?: "already_granted" | "customer_not_found";
}

// Credits the launch minutes exactly once per Stripe payment. Called from two
// places that race each other by design — the webhook
// (checkout.session.completed) and the return page, whichever arrives first —
// so it must be safe to call twice: the unique index on
// credit_transactions.stripe_event_id makes the second call a no-op rather
// than a double grant.
export async function grantWidgetLaunchCredits(params: {
  customerId: string;
  widgetId?: string | null;
  stripeEventId: string;
}): Promise<WidgetLaunchGrantResult> {
  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, email, phone, widget_launch_paid_at")
    .eq("id", params.customerId)
    .maybeSingle<Pick<Customer, "id" | "name" | "email" | "phone" | "widget_launch_paid_at">>();

  if (!customer) return { granted: false, reason: "customer_not_found" };

  // Read before the grant marks it: this is what tells the notification
  // whether it's their first purchase or another widget going live.
  const isFirstPayment = !customer.widget_launch_paid_at;

  try {
    await grantCredits({
      customerId: params.customerId,
      seconds: WIDGET_LAUNCH_SECONDS,
      description: `Voice Widget start: ${WIDGET_LAUNCH_MINUTES} minutter tilføjet`,
      stripeEventId: params.stripeEventId,
    });
  } catch (err) {
    if (isDuplicateEventError(err)) return { granted: false, reason: "already_granted" };
    throw err;
  }

  // Guarded on still-null so a second purchase never rewrites when the
  // customer first went live — the minutes stack on the ledger, the
  // "has paid for the widget" mark doesn't need to move.
  await supabase
    .from("customers")
    .update({ widget_launch_paid_at: new Date().toISOString() })
    .eq("id", params.customerId)
    .is("widget_launch_paid_at", null);

  await writeAuditLog({
    customerId: params.customerId,
    action: "billing.widget_launch_paid",
    entityType: "widget",
    entityId: params.widgetId ?? undefined,
    metadata: { minutes: WIDGET_LAUNCH_MINUTES, stripeEventId: params.stripeEventId },
  });

  // Only reached when this call is the one that actually credited the
  // payment — the duplicate path above returns early — so the webhook and
  // the return page racing each other still produce exactly one email.
  await notifyCustomerPayment({
    customer,
    productLabel: `Voice Widget start: ${WIDGET_LAUNCH_MINUTES} minutter`,
    isFirstPayment,
    minutesGranted: WIDGET_LAUNCH_MINUTES,
  });

  return { granted: true };
}

// PostgREST surfaces a unique-violation as code 23505; the message check is a
// fallback for clients that only pass the text through.
function isDuplicateEventError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.includes("23505") || message.toLowerCase().includes("duplicate key");
}
