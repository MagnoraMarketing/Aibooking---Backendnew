import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Hands the dashboard's floating onboarding/support button (see
// components/dashboard/support-widget.tsx) the one thing it needs to start a
// Vapi call: the platform's (safe-to-expose) public key plus the fixed
// assistant id of AIbooking's own support assistant — not a per-customer
// widget/assistant like everything under app/api/widget/*. Soft-disables
// (enabled: false) rather than erroring when either env var is unset, so a
// deployment that hasn't configured this yet just renders no button instead
// of breaking the dashboard.
export const GET = withErrorHandling(async () => {
  await requireCustomerAdmin();

  const publicKey = process.env.VAPI_PUBLIC_KEY;
  const assistantId = process.env.VAPI_SUPPORT_ASSISTANT_ID;
  if (!publicKey || !assistantId) {
    return NextResponse.json({ enabled: false });
  }

  return NextResponse.json({ enabled: true, publicKey, assistantId });
});
