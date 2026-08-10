import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling, requireParam } from "@/lib/security";
import { getCustomerEconomics } from "@/lib/analytics";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const economics = await getCustomerEconomics(requireParam(params, "id"));
  return NextResponse.json({ economics });
});
