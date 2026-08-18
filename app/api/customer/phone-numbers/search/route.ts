import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling, searchPhoneNumbersQuerySchema } from "@/lib/security";
import { searchAvailableDkNumbers } from "@/lib/twilio";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Searches Danish numbers available to buy on the platform's own Twilio
// account — the "buy a number through us" path (see
// app/api/customer/phone-numbers/purchase). Distinct from the BYO-Twilio
// import flow in app/api/customer/phone-numbers/route.ts, which never talks
// to Twilio's number inventory at all.
export const GET = withErrorHandling(async (request) => {
  await requireCustomerAdmin();
  const { searchParams } = new URL(request.url);
  const parsed = searchPhoneNumbersQuerySchema.safeParse({ areaCode: searchParams.get("areaCode") ?? undefined });
  if (!parsed.success) throw ApiError.badRequest("Invalid search parameters");

  const numbers = await searchAvailableDkNumbers(parsed.data.areaCode);
  return NextResponse.json({ numbers });
});
