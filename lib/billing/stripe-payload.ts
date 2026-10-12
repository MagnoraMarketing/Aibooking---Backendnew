import type Stripe from "stripe";

// Webhook payloads are rendered in the API version of the webhook endpoint
// configured in the Stripe dashboard, not the version our SDK pins (see
// stripe-client.ts). From 2025-03-31 ("basil") on, an invoice no longer has a
// top-level `subscription` — it moved to parent.subscription_details — so
// reading only the old field made every invoice.paid on a newer endpoint a
// silent no-op: 200 to Stripe, no minutes to the customer. Read both.
export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = invoice.subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy?.id) return legacy.id;

  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  }).parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (typeof fromParent === "string") return fromParent;
  return fromParent?.id ?? null;
}
