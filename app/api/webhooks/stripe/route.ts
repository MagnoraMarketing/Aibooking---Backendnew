import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/billing/stripe-client";
import { getAdminClient } from "@/lib/database/admin";
import {
  syncSubscriptionFromStripe,
  markSubscriptionCanceled,
  grantCreditsForPaidInvoice,
} from "@/lib/billing/subscription-sync";
import { writeAuditLog } from "@/lib/security/audit";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Stripe requires the raw request body for signature verification — do not
// route this through readJsonBody/JSON.parse.
export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing webhook signature/secret" }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Idempotency: check first, record only after successful processing. This
  // way a failed attempt (which returns 500 so Stripe retries) gets
  // reprocessed rather than being permanently skipped. Downstream writes
  // (subscription upsert-by-id, the unique index on
  // credit_transactions.stripe_event_id) are themselves idempotent, so a
  // genuine concurrent double-delivery still can't double-credit.
  const { data: existing, error: lookupError } = await supabase
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to check stripe event idempotency:", lookupError.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (typeof session.subscription === "string") {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await syncSubscriptionFromStripe(subscription);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionFromStripe(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await markSubscriptionCanceled(subscription);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId =
          typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subscriptionId) {
          await grantCreditsForPaidInvoice({ stripeSubscriptionId: subscriptionId, stripeEventId: event.id });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId =
          typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subscriptionId) {
          await supabase
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_subscription_id", subscriptionId);

          await writeAuditLog({
            action: "billing.invoice_payment_failed",
            entityType: "stripe_subscription",
            entityId: subscriptionId,
          });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Failed to process Stripe webhook event ${event.id} (${event.type}):`, err);
    // Non-2xx so Stripe retries — we deliberately have NOT recorded this
    // event id yet, so the retry will reprocess it (see idempotency note above).
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  const { error: recordError } = await supabase
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> });

  if (recordError) {
    console.error("Failed to record processed stripe event:", recordError.message);
  }

  return NextResponse.json({ received: true });
}
