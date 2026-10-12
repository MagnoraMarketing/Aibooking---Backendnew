import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling } from "@/lib/security";
import { loadActivity } from "@/lib/aibooking-dashboard/service";
import { listCustomerAgents, loadCustomerPricing, priceCall } from "@/lib/aibooking-dashboard/customer";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [1, 7, 30, 90];

// Every call the customer's own agents had in the period — the same reading
// as the Aibooking.dk Dashboard, scoped to this customer's assistants and
// priced at their package's minute price. Vapi's own cost never leaves here.
export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30;

  const [agents, pricing] = await Promise.all([listCustomerAgents(customerId), loadCustomerPricing(customerId)]);
  const { calls, errors, vapiHistoryFrom } = await loadActivity(agents, days);

  return NextResponse.json({
    agents,
    calls: calls.map((call) => priceCall(call, pricing.pricePerMinute)),
    errors,
    vapiHistoryFrom,
    pricing,
    days,
    fetchedAt: new Date().toISOString(),
  });
});
