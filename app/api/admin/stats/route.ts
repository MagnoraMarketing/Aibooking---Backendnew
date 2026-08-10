import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { withErrorHandling } from "@/lib/security";
import { getSystemStats } from "@/lib/analytics";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const stats = await getSystemStats();
  return NextResponse.json({ stats });
});
