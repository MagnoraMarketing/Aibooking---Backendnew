import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  requireParam,
  bookingSetupRequestInputSchema,
} from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Booking is an opt-in extra: the customer asks for it here, our team does
// the Cal.com and calendar work, and completing the request is what switches
// widgets.booking_enabled on (see the admin route). Nothing the customer can
// do from this endpoint enables booking by itself.

async function requireOwnedWidget(widgetId: string, customerId: string): Promise<void> {
  const supabase = getAdminClient();
  const { data: widget, error } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", widgetId)
    .maybeSingle();

  if (error) throw error;
  // Same 404-for-someone-else's-widget shape the other customer routes use —
  // never confirm that an id exists under a different customer.
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");
}

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const widgetId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;
  await requireOwnedWidget(widgetId, customerId);

  const supabase = getAdminClient();
  const { data: setupRequest, error } = await supabase
    .from("booking_setup_requests")
    .select("id, status, notes, started_at, completed_at, created_at")
    .eq("widget_id", widgetId)
    .maybeSingle();

  if (error) throw error;

  return NextResponse.json({ request: setupRequest });
});

export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const widgetId = requireParam(params, "id");
  const body = await readJsonBody(request, bookingSetupRequestInputSchema);
  const customerId = ctx.profile.customer_id!;
  await requireOwnedWidget(widgetId, customerId);

  const supabase = getAdminClient();

  // One open job per widget (booking_setup_requests has a unique widget_id),
  // so asking twice updates the existing request rather than queueing a
  // duplicate for the team.
  const { data: setupRequest, error } = await supabase
    .from("booking_setup_requests")
    .upsert(
      {
        customer_id: customerId,
        widget_id: widgetId,
        status: "pending",
        request_details: body.notes ? { notes: body.notes } : {},
        created_by: ctx.userId,
      },
      { onConflict: "widget_id" }
    )
    .select("id, status, notes, started_at, completed_at, created_at")
    .single();

  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "booking_setup.requested",
    entityType: "widget",
    entityId: widgetId,
    metadata: { requestId: setupRequest.id },
  });

  return NextResponse.json({ request: setupRequest }, { status: 201 });
});
