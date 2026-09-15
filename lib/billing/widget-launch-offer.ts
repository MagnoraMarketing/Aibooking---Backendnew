// The Voice Widget launch offer: the last step of the creation wizard
// (components/dashboard/agent-tabs/wizard-payment-step.tsx) sends the
// customer to a Stripe Payment Link, and paying it puts
// WIDGET_LAUNCH_MINUTES minutes on their credit ledger and unlocks the embed
// code. It is deliberately a Payment Link rather than a Checkout Session
// created by us: the price and its terms live in Stripe, so marketing can
// change them without a deploy.
//
// This module is the half both sides need — how many minutes the offer buys,
// which link to send people to, and the reference that ties a payment back to
// an account. It touches no database; the granting half is in
// ./widget-launch.ts (server-only).
//
// Because a Payment Link takes no per-request options from us, two things
// have to be set on the link in the Stripe dashboard instead: allow a client
// reference id, and redirect after payment to
//   {NEXT_PUBLIC_APP_URL}/dashboard/checkout/return?session_id={CHECKOUT_SESSION_ID}
// That return page (app/dashboard/checkout/return/page.tsx) credits the
// minutes if the webhook hasn't landed yet and forwards to the agent, so the
// customer really does come back to a page with the minutes ready. It sits
// under /dashboard on purpose: middleware.ts guards that prefix and carries
// the full URL through login as ?next=, so someone who paid in a browser
// without a live session still lands back on their agent. See the Stripe
// block in .env.example.
export const WIDGET_LAUNCH_MINUTES = 200;
export const WIDGET_LAUNCH_SECONDS = WIDGET_LAUNCH_MINUTES * 60;

const DEFAULT_PAYMENT_LINK = "https://buy.stripe.com/cNi6oGa9t6RJ8wQgrF4AU0a";

// Overridable per environment (a test-mode link while developing) but with a
// working production default, so nothing breaks if the variable is unset.
export function getWidgetLaunchPaymentLink(): string {
  const configured = process.env.NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_PAYMENT_LINK;
}

// Stripe allows [A-Za-z0-9_-] in client_reference_id (max 200 chars), which
// covers two UUIDs and a separator. We pack both ids in so the return page
// knows which agent to open, and the webhook knows who to credit — a Payment
// Link carries no metadata of our own otherwise.
const REFERENCE_SEPARATOR = "__";
const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;

export interface WidgetLaunchReference {
  customerId: string;
  widgetId: string | null;
}

export function buildWidgetLaunchReference(params: WidgetLaunchReference): string {
  return params.widgetId ? `${params.customerId}${REFERENCE_SEPARATOR}${params.widgetId}` : params.customerId;
}

export function parseWidgetLaunchReference(reference: string | null | undefined): WidgetLaunchReference | null {
  if (!reference) return null;
  const [customerId, widgetId] = reference.split(REFERENCE_SEPARATOR);
  if (!customerId || !UUID_PATTERN.test(customerId)) return null;
  return { customerId, widgetId: widgetId && UUID_PATTERN.test(widgetId) ? widgetId : null };
}

// The URL the customer is actually sent to. prefilled_email saves them
// retyping it and, more importantly, keeps the Stripe-side customer matched
// to the account that gets the minutes.
export function buildWidgetLaunchUrl(params: { customerId: string; widgetId: string | null; email?: string | null }): string {
  const url = new URL(getWidgetLaunchPaymentLink());
  url.searchParams.set("client_reference_id", buildWidgetLaunchReference(params));
  if (params.email) url.searchParams.set("prefilled_email", params.email);
  return url.toString();
}
