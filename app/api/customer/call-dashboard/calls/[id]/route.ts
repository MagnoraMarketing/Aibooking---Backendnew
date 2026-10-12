import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { loadCallDetail } from "@/lib/aibooking-dashboard/service";
import { listCustomerAgents, loadCustomerPricing, priceCall } from "@/lib/aibooking-dashboard/customer";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One of the customer's calls with transcript and recording. Only a call on
// one of their own agents' assistants is found — anyone else's is a 404.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const id = requireParam(params, "id");
  const [agents, pricing] = await Promise.all([listCustomerAgents(customerId), loadCustomerPricing(customerId)]);
  const call = priceCall(await loadCallDetail(id, agents), pricing.pricePerMinute);
  return NextResponse.json({
    call: {
      ...call,
      // Vapi's grading is written for us, not the customer.
      successEvaluation: null,
      recordingUrl: call.recordingUrl || call.hasRecording ? `/api/customer/call-dashboard/calls/${encodeURIComponent(id)}/recording` : null,
    },
  });
});
