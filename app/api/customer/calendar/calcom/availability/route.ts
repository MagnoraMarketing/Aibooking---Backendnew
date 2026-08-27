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

  // Get connection to find default event type and timezone
  const { accessToken } = await getCalcomTokens(customerId);
  // Note: In a full implementation, we'd fetch connection to get default eventTypeId
  // For now, eventTypeId must be provided or fetch it

  if (!eventTypeId) {
    throw ApiError.badRequest("eventTypeId er påkrævet");
  }

  const slots = await fetchCalcomAvailabilityOAuth({
    accessToken,
    eventTypeId,
    startTime,
    endTime,
    timezone: "Europe/Copenhagen", // TODO: Get from connection
  });

  return NextResponse.json({ slots });
});
