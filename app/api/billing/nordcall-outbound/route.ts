import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { getClientIp, rateLimit, readJsonBody, withErrorHandling, nordcallOutboundRequestSchema } from "@/lib/security";
import { createNordcallOutboundCheckout, getNordcallAppUrl, startNordcallTrial } from "@/lib/billing";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The Outbound page's two actions for the Nordcall add-on: start the free
// trial (10 minutes for 7 days, no card) or open Stripe Checkout for a
// monthly plan. Either way the logged-in user becomes the administrator of
// their own Nordcall team and logs in there with the same email and password.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, nordcallOutboundRequestSchema);

  const rateLimitResult = rateLimit(`billing-nordcall-outbound:${getClientIp(request.headers)}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const { data: customer } = await getAdminClient()
    .from("customers")
    .select("*")
    .eq("id", ctx.profile.customer_id!)
    .single();
  if (!customer) throw ApiError.notFound("Customer not found");

  if (body.action === "trial") {
    await startNordcallTrial({ userId: ctx.userId, customer });
    return NextResponse.json({ url: getNordcallAppUrl() });
  }

  const { url } = await createNordcallOutboundCheckout({ userId: ctx.userId, customer, plan: body.plan });
  return NextResponse.json({ url });
});
