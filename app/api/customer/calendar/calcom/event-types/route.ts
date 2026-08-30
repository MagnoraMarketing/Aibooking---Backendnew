import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling } from "@/lib/security";
import { getCalcomTokens, fetchCalcomEventTypesOAuth } from "@/lib/calendar";

export const dynamic = "force-dynamic";

// Returns available event types from the connected Cal.com account.
// Requires an active Cal.com OAuth connection.
export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;

  const { accessToken } = await getCalcomTokens(customerId);
  const eventTypes = await fetchCalcomEventTypesOAuth(accessToken);

  return NextResponse.json({ eventTypes });
});
