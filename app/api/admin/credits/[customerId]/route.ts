import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { getBalanceSeconds, listTransactions } from "@/lib/credits";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const customerId = requireParam(params, "customerId");
  const [balanceSeconds, transactions] = await Promise.all([
    getBalanceSeconds(customerId),
    listTransactions(customerId),
  ]);

  return NextResponse.json({
    balanceSeconds,
    balanceMinutes: Math.round((balanceSeconds / 60) * 100) / 100,
    transactions,
  });
});
