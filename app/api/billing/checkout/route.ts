import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, checkoutRequestSchema } from "@/lib/security";
import { createCheckoutSession, switchSubscriptionPackage } from "@/lib/billing";
import { ApiError } from "@/types/errors";
import type { Package, Subscription } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, checkoutRequestSchema);
  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", ctx.profile.customer_id!)
    .single();

  if (!customer) throw ApiError.notFound("Customer not found");

  // packageId is only ever resolved against the platform's own trusted
  // `packages` table here — never taken as a price/minutes value from the
  // request body (spec section 11: "Backend skal altid validere package_id
  // mod trusted server-side configuration").
  let pkg: Package | null = null;
  if (body.packageId) {
    const { data } = await supabase.from("packages").select("*").eq("id", body.packageId).eq("active", true).maybeSingle();
    pkg = data;
  } else {
    const { data } = await supabase
      .from("packages")
      .select("*")
      .eq("active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    pkg = data;
  }

  if (!pkg) throw ApiError.badRequest("No package available for checkout");

  const { data: currentSubscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Subscription>();

  const hasActiveSubscription =
    !!currentSubscription && ACTIVE_SUBSCRIPTION_STATUSES.includes(currentSubscription.status);

  if (hasActiveSubscription && currentSubscription!.package_id === pkg.id) {
    throw ApiError.badRequest("I er allerede på denne pakke.");
  }

  // Every package — Starter/Professional/Enterprise included — now checks
  // out through the same code-driven Stripe Checkout Session (see
  // lib/billing/checkout.ts), so the setup fee, package validation and
  // Stripe Price resolution are all enforced from here rather than split
  // across static Stripe Payment Links this route couldn't control.
  //
  // Switching FROM an existing active/trialing subscription updates that
  // subscription's price in place instead of starting a second one, so a
  // customer changing plans is never billed for both (spec section 17).
  if (hasActiveSubscription) {
    const result = await switchSubscriptionPackage({
      customer,
      currentSubscription: currentSubscription!,
      newPackage: pkg,
    });
    return NextResponse.json(result);
  }

  const { url } = await createCheckoutSession({ customer, pkg, includeSetup: body.includeSetup });
  return NextResponse.json({ url });
});
