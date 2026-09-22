import "server-only";
import { getStripeClient } from "./stripe-client";
import type { Customer, Package } from "@/types/database";

export interface RechargeChargeResult {
  success: boolean;
  stripeEventHintId?: string; // invoice id, used for idempotent crediting downstream
  failureReason?: string;
}

// Charges the customer's card on file the package's full monthly price for
// a fresh pool of included_minutes, and returns whether the charge
// succeeded. Called by lib/credits/refill.ts when a customer's minute pool
// is exhausted mid-cycle — this is deliberately the same amount as a normal
// renewal (spec section 7: "alle 150 minutter brugt → Stripe opkræver 999
// kr → nye 150 minutter"), not a smaller per-minute overage top-up.
//
// Billed as a standalone invoice (not tied to the subscription), same as
// the overage-block version this replaced — so it does NOT also trigger
// grantCreditsForPaidInvoice via the invoice.paid webhook (that function
// requires invoice.subscription, which a standalone invoice has none of);
// checkAndRefillIfNeeded grants the credits itself once this call succeeds.
//
// idempotencyKey should be stable across retries of the SAME recharge
// attempt (see lib/credits/refill.ts's recharge_pending_at claim) so a
// crashed request that gets retried can't create a second Stripe charge for
// a pool that was already exhausted once.
export async function chargePackageRecharge(params: {
  customer: Customer;
  pkg: Package;
  idempotencyKey: string;
}): Promise<RechargeChargeResult> {
  const { customer, pkg, idempotencyKey } = params;

  if (!customer.stripe_customer_id) {
    return { success: false, failureReason: "no_stripe_customer" };
  }

  const stripe = getStripeClient();
  const amountInMinorUnits = Math.round(pkg.monthly_price * 100);

  if (amountInMinorUnits <= 0) {
    return { success: false, failureReason: "invalid_recharge_amount" };
  }

  try {
    await stripe.invoiceItems.create(
      {
        customer: customer.stripe_customer_id,
        amount: amountInMinorUnits,
        currency: pkg.currency.toLowerCase(),
        description: `Automatisk fornyelse: ${pkg.included_minutes} nye minutter (${pkg.package_name})`,
      },
      { idempotencyKey: `${idempotencyKey}_item` }
    );

    const invoice = await stripe.invoices.create(
      {
        customer: customer.stripe_customer_id,
        collection_method: "charge_automatically",
        auto_advance: true,
        metadata: { aibooking_customer_id: customer.id, aibooking_reason: "pool_recharge" },
      },
      { idempotencyKey: `${idempotencyKey}_invoice` }
    );

    if (!invoice.id) return { success: false, failureReason: "invoice_creation_failed" };

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    const paid = await stripe.invoices.pay(finalized.id!, undefined, { idempotencyKey: `${idempotencyKey}_pay` });

    if (paid.status === "paid") {
      return { success: true, stripeEventHintId: paid.id };
    }

    return { success: false, failureReason: `invoice_status_${paid.status}` };
  } catch (err) {
    return {
      success: false,
      failureReason: err instanceof Error ? err.message : "unknown_stripe_error",
    };
  }
}
