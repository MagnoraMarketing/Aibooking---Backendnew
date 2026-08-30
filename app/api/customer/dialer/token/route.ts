import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getOrCreateDialerApp, createDialerAccessToken } from "@/lib/twilio";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Mints a short-lived Twilio Voice access token scoped to the customer's
// own Twilio subaccount (lib/twilio/dialer.ts) — the manual dialer
// (components/dashboard/dialer-manager.tsx) uses this to open a
// Twilio.Device in the browser and place outgoing calls that bill and show
// caller ID under the customer's own number, not the platform's. First
// call for a customer also provisions their dialer TwiML App/Signing Key
// on Twilio, which adds a couple of extra round-trips — negligible after
// that, since it's then cached on twilio_subaccounts.
export const POST = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;

  const app = await getOrCreateDialerApp(customerId);
  const token = createDialerAccessToken(app, `dialer-${ctx.userId}`);

  return NextResponse.json({ token });
});
