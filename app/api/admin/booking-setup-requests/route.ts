import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  bookingSetupStatusSchema,
  updateBookingSetupRequestSchema,
} from "@/lib/security";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const statusParam = new URL(request.url).searchParams.get("status");
  const status = statusParam ? bookingSetupStatusSchema.safeParse(statusParam) : null;
  if (status && !status.success) throw ApiError.badRequest("Ugyldig status");

  let query = supabase
    .from("booking_setup_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (status?.success) query = query.eq("status", status.data);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ requests: data ?? [] });
});

// Completing a setup request is what actually turns booking on: it flips
// widgets.booking_enabled and re-syncs the Vapi assistant so it gains the
// booking tools. Cancelling reverses both, so an agent can never keep
// offering bookings after its setup was pulled.
export const PATCH = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, updateBookingSetupRequestSchema);
  const supabase = getAdminClient();

  // Completing is what switches booking on for the customer's agent, so it
  // requires a calendar that actually works. Without this an agent would tell
  // callers it can book and then fail on every single attempt. Enforced here
  // and not only in the admin table's disabled button — a guard that lives
  // solely in the UI is not a guard.
  if (body.status === "completed") {
    const { data: pending } = await supabase
      .from("booking_setup_requests")
      .select("widget_id")
      .eq("id", body.id)
      .maybeSingle();

    if (!pending) throw ApiError.notFound("Booking setup request not found");

    const { data: connection } = await supabase
      .from("calendar_connections")
      .select("id")
      .eq("widget_id", pending.widget_id)
      .eq("provider", "calcom")
      .eq("status", "connected")
      .maybeSingle();

    if (!connection) {
      throw ApiError.badRequest(
        "Kunden har ingen forbundet Cal.com-kalender endnu — forbind kalenderen før opsætningen markeres færdig."
      );
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: body.status };
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status === "in_progress") {
    patch.started_at = now;
    patch.assigned_to = body.assignedTo ?? ctx.userId;
  }
  if (body.status === "completed") patch.completed_at = now;

  const { data: setupRequest, error } = await supabase
    .from("booking_setup_requests")
    .update(patch)
    .eq("id", body.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!setupRequest) throw ApiError.notFound("Booking setup request not found");

  if (body.status === "completed" || body.status === "cancelled") {
    const bookingEnabled = body.status === "completed";

    const { data: widget, error: widgetError } = await supabase
      .from("widgets")
      .update({ booking_enabled: bookingEnabled })
      .eq("id", setupRequest.widget_id)
      .select("*")
      .maybeSingle();
    if (widgetError) throw widgetError;

    if (widget) {
      const { data: settings } = await supabase
        .from("widget_settings")
        .select("extra")
        .eq("widget_id", widget.id)
        .maybeSingle();

      // Best-effort, like every other caller of this helper: a Vapi hiccup
      // shouldn't roll back the status the team just set. The next save of
      // the agent re-syncs it.
      await syncWidgetToVapiAssistant(widget, (settings?.extra as Record<string, unknown>) ?? {});
    }
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: setupRequest.customer_id,
    action: "booking_setup.updated",
    entityType: "widget",
    entityId: setupRequest.widget_id,
    metadata: { requestId: setupRequest.id, status: body.status },
  });

  return NextResponse.json({ request: setupRequest });
});
