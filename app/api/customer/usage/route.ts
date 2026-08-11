import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling } from "@/lib/security";
import { getCustomerEconomics } from "@/lib/analytics";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const economics = await getCustomerEconomics(ctx.profile.customer_id!);

  // Customer-facing view never includes raw AI/TTS cost or gross margin —
  // that's internal AIbooking economics (see admin/customers/[id]/usage).
  return NextResponse.json({
    minutesUsed: economics.minutesUsed,
    minutesRemaining: economics.minutesRemaining,
    totalConversations: economics.totalConversations,
    averageConversationDurationSeconds: economics.averageConversationDurationSeconds,
    currentPackagePrice: economics.currentMonthlyPrice,
    currentPackageName: economics.currentPackageName,
    includedMinutes: economics.includedMinutes,
    currency: economics.currency,
  });
});
