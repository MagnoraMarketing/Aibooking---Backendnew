import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/billing/stripe-client";
import { getAdminClient } from "@/lib/database/admin";
import {
  syncSubscriptionFromStripe,
  markSubscriptionCanceled,
  grantCreditsForPaidInvoice,
} from "@/lib/billing/subscription-sync";
import { grantWidgetLaunchCredits, parseWidgetLaunchReference } from "@/lib/billing/widget-launch";
import { parsePackageLaunchReference } from "@/lib/billing/package-launch-offer";
import { getInvoiceSubscriptionId } from "@/lib/billing/stripe-payload";
import { writeAuditLog } from "@/lib/security/audit";
import { provisionVapiNumbersForNewlyPaidCustomer } from "@/lib/phone-numbers";
import type { SyncedSubscription } from "@/lib/billing/subscription-sync";

// A phone agent's number is gated on having an active subscription (see
// app/api/customer/phone-numbers/vapi/route.ts) — this is what actually
// grants it the moment that becomes true, for any phone agent the customer
// already built during the trial. Only "active" counts, same threshold the
// gate itself checks; a subscription that synced as anything else (past_due,
// incomplete, canceled) grants nothing.
async function provisionInboundNumbersIfNewlyActive(synced: SyncedSubscription | null): Promise<void> {
  if (synced?.status !== "active") return;
  await provisionVapiNumbersForNewlyPaidCustomer(synced.customerId);
}

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Stripe requires the raw request body for signature verification — do not
// route this through readJsonBody/JSON.parse.
export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // A missing secret is our misconfiguration, not a malformed request from
  // Stripe — and it's the kind that hides: Stripe shows failed deliveries in
  // its own dashboard while nothing here says why, and no invoice.paid ever
  // grants the customer their minutes.
  if (!webhookSecret) {
    console.error(
      "[stripe] STRIPE_WEBHOOK_SECRET is not set — every webhook is rejected, so paid invoices never grant credits."
    );
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ error: "Missing webhook signature" }, { status: 400 });
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
          // A subscription bought through a package-launch Payment Link
          // (lib/billing/package-launch-offer.ts) carries no subscription
          // metadata of ours — the customer/package pairing rides on this
          // Checkout Session's client_reference_id instead, so pass it
          // through explicitly rather than relying on metadata lookup.
          const packageLaunchRef = parsePackageLaunchReference(session.client_reference_id);
          const synced = await syncSubscriptionFromStripe(subscription, packageLaunchRef ?? undefined);
          await provisionInboundNumbersIfNewlyActive(synced);
        }

        // The wizard's closing payment step is a Stripe Payment Link, which
        // carries no metadata of ours — the customer/widget it belongs to
        // rides along in client_reference_id instead (see
        // lib/billing/widget-launch.ts). A one-off payment produces no
        // invoice.paid for a subscription of ours, so this is where those
        // 150 minutes get credited. The return page may beat this webhook to
        // it; grantWidgetLaunchCredits is idempotent either way.
        const launchReference = parseWidgetLaunchReference(session.client_reference_id);
        if (launchReference && session.payment_status === "paid" && !session.subscription) {
          await grantWidgetLaunchCredits({
            customerId: launchReference.customerId,
            widgetId: launchReference.widgetId,
            stripeEventId: session.id,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const synced = await syncSubscriptionFromStripe(subscription);
        await provisionInboundNumbersIfNewlyActive(synced);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await markSubscriptionCanceled(subscription);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (subscriptionId) {
          await grantCreditsForPaidInvoice({
            stripeSubscriptionId: subscriptionId,
            stripeEventId: event.id,
            amountPaid: invoice.amount_paid,
            currency: invoice.currency,
            billingReason: invoice.billing_reason,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
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
