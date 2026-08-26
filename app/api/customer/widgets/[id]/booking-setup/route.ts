import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog } from "@/lib/security";
import { ApiError } from "@/types/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bookingSetupRequestSchema = z.object({
  description: z.string().optional(),
});

export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const widgetId = params.id as string;
  const body = await readJsonBody(request, bookingSetupRequestSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  // Verify widget belongs to customer
  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", widgetId)
    .maybeSingle();

  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) {
    throw ApiError.notFound("Widget not found");
  }

  // Create or update booking setup request
  const { data: request: setupRequest, error: requestError } = await supabase
    .from("booking_setup_requests")
    .upsert(
      {
        customer_id: customerId,
        widget_id: widgetId,
        status: "pending",
        request_details: body.description ? { description: body.description } : null,
        created_by: ctx.userId,
      },
      { onConflict: "widget_id" }
    )
    .select("*")
    .single();

  if (requestError) throw requestError;

  // Update widget to mark booking as requested
  const { error: updateError } = await supabase
    .from("widget_settings")
    .update({
      booking_setup_status: "pending",
      booking_setup_started_at: new Date().toISOString(),
    })
    .eq("widget_id", widgetId);

  if (updateError) throw updateError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "booking_setup.requested",
    entityType: "widget",
    entityId: widgetId,
    metadata: { request_id: setupRequest.id },
  });

  return NextResponse.json(
    {
      request: setupRequest,
      message: "Booking setup anmodning sendt. Vi kontakter jer inden for 24 timer for at fuldføre opsætningen.",
    },
    { status: 201 }
  );
});

export const GET = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const widgetId = params.id as string;
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  // Verify widget belongs to customer
  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", widgetId)
    .maybeSingle();

  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) {
    throw ApiError.notFound("Widget not found");
  }

  const { data: setupRequest, error } = await supabase
    .from("booking_setup_requests")
    .select("*")
    .eq("widget_id", widgetId)
    .maybeSingle();

  if (error) throw error;

  return NextResponse.json({ request: setupRequest });
});
