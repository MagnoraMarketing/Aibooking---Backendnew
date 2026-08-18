import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, rateLimit, getClientIp } from "@/lib/security";
import { createCheckoutSession, getOrCreateIntroOfferCoupon } from "@/lib/billing";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// The Inbound page's "prøv i 30 dage til 499 kr, derefter 999 kr" pitch
// (see /dashboard/inbound/free-trial) — a real Stripe subscription on the
// default package with a one-time 50% off coupon on the first invoice,
// rather than a free access bypass. Only ever available once per customer:
// gated on having never subscribed before AND never having redeemed the
// offer (customers.intro_offer_used_at), so it can't be restarted by
// cancelling and re-checking out.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;

  const rateLimitResult = rateLimit(`billing-intro-offer:${getClientIp(request.headers)}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const supabase = getAdminClient();

  const { data: customer } = await supabase.from("customers").select("*").eq("id", customerId).single();
  if (!customer) throw ApiError.notFound("Customer not found");

  if (customer.intro_offer_used_at) {
    throw ApiError.conflict("I har allerede brugt introtilbuddet. Se jeres abonnement under Betaling.");
  }

  const { data: existingSubscription } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (existingSubscription) {
    throw ApiError.conflict("Introtilbuddet er kun for nye kunder uden et eksisterende abonnement.");
  }

  const { data: pkg } = await supabase
    .from("packages")
    .select("*")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pkg) throw ApiError.badRequest("No package available for checkout");

  const couponId = await getOrCreateIntroOfferCoupon();
  const appUrl = getAppUrl();

  const { url } = await createCheckoutSession({
    customer,
    pkg,
    discountCouponId: couponId,
    successUrl: `${appUrl}/dashboard/inbound?openTrial=1&introOfferPaid=1`,
    cancelUrl: `${appUrl}/dashboard/inbound/free-trial?checkout=cancelled`,
    subscriptionMetadata: { aibooking_intro_offer: "true" },
  });

  return NextResponse.json({ url });
});
