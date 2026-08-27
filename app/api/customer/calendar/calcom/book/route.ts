import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { withErrorHandling, readJsonBody } from "@/lib/security";
import { getCalcomTokens, createCalcomBookingOAuth } from "@/lib/calendar";
import { getAdminClient } from "@/lib/database/admin";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bookingSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  startTime: z.string().datetime(),
  eventTypeId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional(),
});

// Creates a booking in Cal.com and records it in AIbooking appointments table.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, bookingSchema);

  const { accessToken } = await getCalcomTokens(customerId);

  // Create booking in Cal.com
  const booking = await createCalcomBookingOAuth({
    accessToken,
    eventTypeId: body.eventTypeId,
    start: body.startTime,
    name: body.name,
    email: body.email,
    notes: body.notes,
    timezone: "Europe/Copenhagen", // TODO: Get from connection
  });

  // Record in AIbooking appointments table for dashboard visibility
  const supabase = getAdminClient();
  const { error: appointmentError } = await supabase.from("appointments").insert({
    customer_id: customerId,
    customer_name: body.name,
    appointment_time: body.startTime,
    status: "booked",
  });

  if (appointmentError) {
    console.error("Failed to record appointment:", appointmentError);
    // Non-fatal — the Cal.com booking succeeded
  }

  return NextResponse.json(
    {
      id: booking.id,
      uid: booking.uid,
      status: booking.status,
    },
    { status: 201 }
  );
});
