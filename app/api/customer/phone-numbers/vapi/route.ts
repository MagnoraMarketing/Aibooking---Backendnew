import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, vapiNumberInputSchema } from "@/lib/security";
import { provisionVapiNumberForWidget } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Gives an agent an inbound number handed out by Vapi, wired to its assistant
// from the moment it exists. The customer keeps the number their customers
// already call and forwards it here, so nobody has to own a Twilio account or
// move an existing line — see supabase/migrations/0037_vapi_inbound_numbers.sql.
// The actual provisioning lives in lib/phone-numbers/vapi-provision.ts, shared
// with the auto-assignment that runs right after a Stripe payment.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, vapiNumberInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  // Same gate as the Twilio purchase route (app/api/customer/phone-numbers/
  // purchase/route.ts): a phone number — free-to-the-customer or not — is a
  // paid-plan feature. Building and testing a phone agent stays free during
  // the trial; only the number itself requires an active subscription (a
  // real Stripe subscription, which the 499kr intro offer also creates).
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscription?.status !== "active") {
    throw ApiError.paymentRequired(
      "Et gratis indgående nummer kræver et aktivt abonnement — start introtilbuddet eller vælg en pakke under Betaling."
    );
  }

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, name, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const phoneNumber = await provisionVapiNumberForWidget({
    customerId,
    widget,
    label: body.label,
    areaCode: body.areaCode,
    vapiPhoneNumberId: body.vapiPhoneNumberId,
    actor: { userId: ctx.userId, role: ctx.profile.role },
  });

  return NextResponse.json({ phoneNumber }, { status: 201 });
});
