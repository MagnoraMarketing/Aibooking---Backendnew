import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling, readJsonBody } from "@/lib/security";
import { getCalcomTokens, fetchCalcomAvailabilityOAuth } from "@/lib/calendar";
import { z } from "zod";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  eventTypeId: z.coerce.number().int().positive().optional(),
});

// Returns available time slots for the specified date range and event type.
export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const { searchParams } = new URL(request.url);

  const parsed = querySchema.safeParse({
    startTime: searchParams.get("startTime"),
    endTime: searchParams.get("endTime"),
    eventTypeId: searchParams.get("eventTypeId"),
  });

  if (!parsed.success) {
    throw ApiError.badRequest("Invalid query parameters");
  }

  const { startTime, endTime, eventTypeId } = parsed.data;

  // The connection carries the customer's timezone and their default event
  // type, so a caller only has to name one to override it.
  const { accessToken, timezone, defaultEventTypeId } = await getCalcomTokens(customerId);

  const resolvedEventTypeId = eventTypeId ?? defaultEventTypeId;
  if (!resolvedEventTypeId) {
    throw ApiError.badRequest(
      "eventTypeId er påkrævet — vælg en standard begivenhedstype på Cal.com-forbindelsen"
    );
  }

  const slots = await fetchCalcomAvailabilityOAuth({
    accessToken,
    eventTypeId: resolvedEventTypeId,
    startTime,
    endTime,
    timezone,
  });

  return NextResponse.json({ slots });
});
