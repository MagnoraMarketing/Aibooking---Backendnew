import "server-only";
import { getStripeClient } from "./stripe-client";
import type { Customer, Package } from "@/types/database";

export interface OverageChargeResult {
  success: boolean;
  stripeEventHintId?: string; // invoice id, used for idempotent crediting downstream
  failureReason?: string;
}

// Charges the customer's card on file for one extra block of
// `included_minutes` at the package's overage rate, and returns whether the
// charge succeeded. Called by lib/credits/refill.ts when a customer runs
// out of included minutes mid-cycle (section 6: automatic credit refill).
export async function chargeOverageBlock(params: {
  customer: Customer;
  pkg: Package;
}): Promise<OverageChargeResult> {
  const { customer, pkg } = params;

  if (!customer.stripe_customer_id) {
    return { success: false, failureReason: "no_stripe_customer" };
  }

  const stripe = getStripeClient();
  const amountInMinorUnits = Math.round(pkg.overage_price_per_minute * pkg.included_minutes * 100);

  if (amountInMinorUnits <= 0) {
    return { success: false, failureReason: "invalid_overage_amount" };
  }

  try {
    await stripe.invoiceItems.create({
      customer: customer.stripe_customer_id,
      amount: amountInMinorUnits,
      currency: pkg.currency.toLowerCase(),
      description: `Automatisk tilkøb: ${pkg.included_minutes} ekstra minutter (${pkg.package_name})`,
    });

    const invoice = await stripe.invoices.create({
      customer: customer.stripe_customer_id,
      collection_method: "charge_automatically",
      auto_advance: true,
      metadata: { aibooking_customer_id: customer.id, aibooking_reason: "overage_refill" },
    });

    if (!invoice.id) return { success: false, failureReason: "invoice_creation_failed" };

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    const paid = await stripe.invoices.pay(finalized.id!);

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
