import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  checkoutPhoneNumberInputSchema,
  rateLimit,
  getClientIp,
} from "@/lib/security";
import { ensureStripeCustomer, getStripeClient } from "@/lib/billing";
import { DK_LOCAL_NUMBER_MONTHLY_PRICE_DKK } from "@/lib/twilio";
import { ApiError } from "@/types/errors";
import type { Customer } from "@/types/database";

export const dynamic = "force-dynamic";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getPhoneNumberPriceId(): string {
  const priceId = process.env.STRIPE_PHONE_NUMBER_PRICE_ID;
  if (!priceId) throw ApiError.badRequest("Køb af telefonnumre er ikke sat op endnu. Kontakt support.");
  return priceId;
}

// Starts a payment-gated phone number purchase: creates a `pending_payment`
// phone_numbers row for the number the customer picked, then a Stripe
// Checkout Session for the monthly rental price. The actual Twilio
// purchase only happens once Stripe confirms payment via webhook (see
// app/api/webhooks/stripe/route.ts -> lib/phone-numbers/provisionPurchasedNumber) —
// never here, and never based on a price the frontend sent us.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();

  const rateLimitResult = rateLimit(`phone-number-checkout:${getClientIp(request.headers)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const body = await readJsonBody(request, checkoutPhoneNumberInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widget.id)
    .maybeSingle();
  const assistantId = (settings?.extra as Record<string, unknown> | null)?.vapiAssistantId;
  if (typeof assistantId !== "string") {
    throw ApiError.badRequest("Denne agent har ikke en Vapi-assistent endnu");
  }

  const priceId = getPhoneNumberPriceId();

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single<Customer>();
  if (customerError) throw customerError;

  const stripeCustomerId = await ensureStripeCustomer(customer);
  const stripe = getStripeClient();
  const appUrl = getAppUrl();

  const { data: phoneNumberRow, error } = await supabase
    .from("phone_numbers")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      phone_number: body.phoneNumber,
      label: body.label ?? null,
      source: "platform_twilio",
      direction: body.direction,
      purchase_status: "pending_payment",
      monthly_price_dkk: DK_LOCAL_NUMBER_MONTHLY_PRICE_DKK,
    })
    .select("id")
    .single();
  if (error) throw error;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/inbound?purchase=processing`,
    cancel_url: `${appUrl}/dashboard/inbound?purchase=cancelled`,
    metadata: {
      type: "phone_number_purchase",
      aibooking_customer_id: customerId,
      phone_number_row_id: phoneNumberRow.id,
    },
    subscription_data: {
      metadata: {
        type: "phone_number_purchase",
        aibooking_customer_id: customerId,
        phone_number_row_id: phoneNumberRow.id,
      },
    },
  });

  if (!session.url) throw ApiError.internal("Stripe returnerede ingen betalings-URL");

  await supabase.from("phone_numbers").update({ stripe_checkout_session_id: session.id }).eq("id", phoneNumberRow.id);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.checkout_started",
    entityType: "phone_number",
    entityId: phoneNumberRow.id,
    metadata: { widgetId: widget.id, phoneNumber: body.phoneNumber },
  });

  return NextResponse.json({ checkoutUrl: session.url });
});
