import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import type { AppointmentStatus } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Cal.com signs deliveries with HMAC-SHA256 over the raw request body, hex
// encoded, in x-cal-signature-256. The body has to be verified exactly as
// sent — re-serializing the parsed JSON can reorder keys or change spacing
// and would fail an otherwise valid signature.
function isValidSignature(rawBody: string, received: string | null, secret: string): boolean {
  if (!received) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const receivedBuf = Buffer.from(received.trim(), "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// Cal.com's own naming for the events we care about.
const STATUS_BY_TRIGGER: Record<string, AppointmentStatus> = {
  BOOKING_CREATED: "booked",
  BOOKING_RESCHEDULED: "booked",
  BOOKING_CANCELLED: "cancelled",
  BOOKING_REJECTED: "cancelled",
};

interface CalcomWebhookPayload {
  uid?: unknown;
  bookingId?: unknown;
  startTime?: unknown;
  eventTypeId?: unknown;
  attendees?: unknown;
  responses?: unknown;
}

function firstAttendeeName(payload: CalcomWebhookPayload): string | null {
  const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const name = (attendees[0] as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name.trim() ? name : null;
}

// Keeps our appointment rows honest about what's actually in the calendar.
// Bookings can be moved or called off from three places we don't control —
// the attendee's Cal.com cancellation link, the business editing its own
// calendar, and Cal.com itself rejecting one — and without this the dashboard
// would keep showing them as upcoming.
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) {
    // Deliberately not an error: a deployment that hasn't configured Cal.com
    // webhooks yet shouldn't look broken, and there is nothing to verify
    // against, so nothing may be trusted or written.
    return NextResponse.json({ received: false, reason: "not_configured" }, { status: 202 });
  }

  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get("x-cal-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { triggerEvent?: unknown; payload?: CalcomWebhookPayload } | null = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const trigger = typeof body?.triggerEvent === "string" ? body.triggerEvent : null;
  const payload = body?.payload ?? {};
  const status = trigger ? STATUS_BY_TRIGGER[trigger] : undefined;

  // Cal.com fires many trigger types (forms, recordings, no-shows). Anything
  // we don't map is acknowledged so Cal.com stops retrying it.
  if (!status) {
    return NextResponse.json({ received: true, ignored: trigger });
  }

  const uid = typeof payload.uid === "string" ? payload.uid : null;
  if (!uid) {
    return NextResponse.json({ received: true, ignored: "missing_uid" });
  }

  const supabase = getAdminClient();

  const { data: existing, error: lookupError } = await supabase
    .from("appointments")
    .select("id")
    .eq("calcom_booking_uid", uid)
    .maybeSingle();

  if (lookupError) {
    console.error("Cal.com webhook lookup failed:", lookupError.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const startTime = typeof payload.startTime === "string" ? payload.startTime : null;

  if (existing) {
    const patch: Record<string, unknown> = { status };
    if (startTime) patch.appointment_time = startTime;

    const { error } = await supabase.from("appointments").update(patch).eq("id", existing.id);
    if (error) {
      console.error("Cal.com webhook update failed:", error.message);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    return NextResponse.json({ received: true, updated: existing.id });
  }

  // A booking we have no row for — made directly on Cal.com rather than
  // through the agent. Attribute it via the event type, which is the only
  // link back to a widget that a non-agent booking carries.
  const eventTypeId = payload.eventTypeId;
  if (eventTypeId === undefined || eventTypeId === null) {
    return NextResponse.json({ received: true, ignored: "unmatched" });
  }

  const { data: connection } = await supabase
    .from("calendar_connections")
    .select("customer_id, widget_id")
    .eq("provider", "calcom")
    .eq("calcom_event_type_id", String(eventTypeId))
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ received: true, ignored: "unmatched" });
  }

  if (!startTime) {
    return NextResponse.json({ received: true, ignored: "missing_start_time" });
  }

  const { error: insertError } = await supabase.from("appointments").insert({
    customer_id: connection.customer_id,
    widget_id: connection.widget_id,
    customer_name: firstAttendeeName(payload),
    appointment_time: startTime,
    status,
    calcom_booking_uid: uid,
    calcom_booking_id: typeof payload.bookingId === "number" ? payload.bookingId : null,
  });

  if (insertError) {
    console.error("Cal.com webhook insert failed:", insertError.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, created: uid });
}
