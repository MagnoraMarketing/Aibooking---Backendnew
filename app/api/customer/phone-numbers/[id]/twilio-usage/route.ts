import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { getTwilioCallMinutesSummary } from "@/lib/twilio";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Live Twilio balance + inbound/outbound minutes for one BYO-Twilio number
// (see app/dashboard/inbound/free-trial's "~75 min free trial" copy) — the
// customer's own twilio_account_sid/twilio_auth_token are read here and
// used server-side only to call Twilio; only the resulting numbers are
// returned, never the credentials themselves (see
// lib/phone-numbers/columns.ts for why that distinction matters).
// Platform-purchased numbers don't have this: they run under our own
// Twilio subaccount, which isn't a customer-specific trial balance to show.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const phoneNumberId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: phoneNumber, error } = await supabase
    .from("phone_numbers")
    .select("customer_id, source, twilio_account_sid, twilio_auth_token")
    .eq("id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  if (!phoneNumber || phoneNumber.customer_id !== customerId) throw ApiError.notFound("Phone number not found");
  if (phoneNumber.source !== "byo_twilio" || !phoneNumber.twilio_account_sid || !phoneNumber.twilio_auth_token) {
    throw ApiError.badRequest("Twilio-forbrug er kun tilgængeligt for jeres egne tilsluttede Twilio-numre");
  }

  const summary = await getTwilioCallMinutesSummary({
    accountSid: phoneNumber.twilio_account_sid,
    authToken: phoneNumber.twilio_auth_token,
  });

  return NextResponse.json(summary);
});
