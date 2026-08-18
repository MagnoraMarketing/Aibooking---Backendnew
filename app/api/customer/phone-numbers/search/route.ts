import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling, searchPhoneNumbersQuerySchema, rateLimit, getClientIp } from "@/lib/security";
import { searchAvailableDkNumbers, getOrCreateSubaccount } from "@/lib/twilio";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Searches Danish numbers available to buy through the platform — the "buy
// a number through us" path (see app/api/customer/phone-numbers/purchase).
// Runs under the customer's own Twilio subaccount (created lazily here on
// first search), so inventory/eligibility checks are scoped exactly the
// way the eventual purchase will be. Distinct from the BYO-Twilio import
// flow in app/api/customer/phone-numbers/route.ts, which never talks to
// Twilio's number inventory at all.
export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();

  const rateLimitResult = rateLimit(`phone-number-search:${getClientIp(request.headers)}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const { searchParams } = new URL(request.url);
  const parsed = searchPhoneNumbersQuerySchema.safeParse({ areaCode: searchParams.get("areaCode") ?? undefined });
  if (!parsed.success) throw ApiError.badRequest("Invalid search parameters");

  const credentials = await getOrCreateSubaccount(ctx.profile.customer_id!);
  const numbers = await searchAvailableDkNumbers(credentials, parsed.data.areaCode);
  return NextResponse.json({ numbers });
});
