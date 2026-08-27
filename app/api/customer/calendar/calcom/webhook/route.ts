import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

function validateCalcomWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");
  return signature === expectedSignature;
}

// Handles Cal.com webhook events (booking created, cancelled, rescheduled, etc.)
export const POST = withErrorHandling(async (request) => {
  const webhookSecret = process.env.CALCOM_WEBHOOK_SECRET;
  requireParam(webhookSecret, "CALCOM_WEBHOOK_SECRET");

  const signature = request.headers.get("x-cal-signature");
  if (!signature) {
    throw ApiError.badRequest("Missing webhook signature");
  }

  const body = await request.text();
  if (!validateCalcomWebhookSignature(body, signature, webhookSecret)) {
    throw ApiError.unauthorized("Invalid webhook signature");
  }

  const payload = JSON.parse(body) as {
    triggerEvent: string;
    createdAt: string;
    data?: {
      eventTypeId?: number;
      uid?: string;
      startTime?: string;
      endTime?: string;
      attendees?: Array<{ email?: string; name?: string }>;
      organizer?: { email?: string };
      title?: string;
    };
  };

  const supabase = getAdminClient();
  const event = payload.triggerEvent;

  // Handle different event types
  switch (event) {
    case "BOOKING_CREATED":
    case "BOOKING_RESCHEDULED":
      if (payload.data?.uid) {
        // Log booking event for analytics/debugging
        // Note: In a full implementation, you might sync this to a webhooks_log table
        console.log("Cal.com booking event:", event, payload.data);
      }
      break;

    case "BOOKING_CANCELLED":
      if (payload.data?.uid) {
        // Mark appointment as cancelled if tracked in AIbooking
        console.log("Cal.com booking cancelled:", payload.data.uid);
      }
      break;

    default:
      console.log("Unhandled Cal.com webhook event:", event);
  }

  // Return 200 immediately to acknowledge receipt (Cal.com will retry if it doesn't get 200)
  return NextResponse.json({ received: true }, { status: 200 });
});
