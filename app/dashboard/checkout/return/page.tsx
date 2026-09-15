import { redirect } from "next/navigation";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getStripeClient } from "@/lib/billing/stripe-client";
import { grantWidgetLaunchCredits, parseWidgetLaunchReference } from "@/lib/billing/widget-launch";

export const dynamic = "force-dynamic";

// Where the Stripe Payment Link drops the customer after paying — the link's
// own "redirect after payment" points here, with ?session_id= appended (see
// lib/billing/widget-launch-offer.ts). The webhook is what *guarantees* the
// minutes get credited, but it can land seconds after the browser redirect
// does — and the whole point of this step is that the customer comes back to
// a page where the minutes are already there. So this page does the same grant
// itself, keyed on the Checkout Session id exactly as the webhook keys it,
// which makes whichever arrives second a no-op instead of a double grant.
//
// It renders nothing: every path ends in a redirect to the agent (or the
// agent list), with ?paid=1 for the success banner.
export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const ctx = await requireCustomerAdminForPage();
  const customerId = ctx.profile.customer_id!;

  const sessionId = searchParams.session_id;
  if (!sessionId) {
    // Stripe wasn't configured to pass {CHECKOUT_SESSION_ID} through. The
    // webhook still credits the purchase, so send them on rather than
    // showing an error for something they can't act on.
    redirect("/dashboard/agent?paid=1");
  }

  let widgetId: string | null = null;
  let paid = false;

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const reference = parseWidgetLaunchReference(session.client_reference_id);

    // Only ever credit the account the *Stripe* session names, and only when
    // that's the account currently signed in — a session id from someone
    // else's purchase must not move minutes here (the webhook credits the
    // real owner regardless).
    if (reference && reference.customerId === customerId && session.payment_status === "paid") {
      widgetId = reference.widgetId;
      paid = true;
      await grantWidgetLaunchCredits({
        customerId: reference.customerId,
        widgetId: reference.widgetId,
        stripeEventId: session.id,
      });
    }
  } catch (err) {
    // A Stripe outage here must not strand a customer who has already paid:
    // fall through to the agent list, where the webhook's grant shows up on
    // its own once it lands.
    console.error("Failed to finalise widget launch checkout return:", err);
  }

  if (widgetId) {
    redirect(`/dashboard/agent/${widgetId}?tab=embed&paid=1`);
  }
  redirect(`/dashboard/agent${paid ? "?paid=1" : ""}`);
}
