import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp, listByoPhoneNumbersInputSchema } from "@/lib/security";
import { listOwnedPhoneNumbers } from "@/lib/twilio";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Lets the BYO-Twilio form look up the customer's own numbers by their
// Account SID + Auth Token, so they can pick one from a dropdown instead
// of typing an E.164 number by hand — same transient-credentials pattern
// as the existing BYO import (app/api/customer/phone-numbers/route.ts):
// used for this one request only, never persisted.
export const POST = withErrorHandling(async (request) => {
  await requireCustomerAdmin();

  const rateLimitResult = rateLimit(`phone-number-byo-list:${getClientIp(request.headers)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const body = await readJsonBody(request, listByoPhoneNumbersInputSchema);

  const numbers = await listOwnedPhoneNumbers({
    accountSid: body.twilioAccountSid,
    authToken: body.twilioAuthToken,
  });

  return NextResponse.json({ numbers });
});
