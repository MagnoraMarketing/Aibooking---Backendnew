import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, readJsonBody, calcomUpdateEventTypeSchema, writeAuditLog } from "@/lib/security";
import { getCalcomTokens, fetchCalcomEventTypesOAuth } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Updates the selected event type for the customer's Cal.com connection.
export const PATCH = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, calcomUpdateEventTypeSchema);
  const supabase = getAdminClient();

  // Get connection to verify it exists
  const { data: connection, error: connectionError } = await supabase
    .from("calcom_connections")
    .select("id, calcom_event_type_id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (connectionError) throw connectionError;
  if (!connection) {
    throw ApiError.notFound("Cal.com er ikke forbundet");
  }

  // Verify the event type exists in Cal.com
  const { accessToken } = await getCalcomTokens(customerId);
  const eventTypes = await fetchCalcomEventTypesOAuth(accessToken);

  if (!eventTypes.some((et) => et.id === body.eventTypeId)) {
    throw ApiError.badRequest("Den valgte event-type findes ikke på jeres Cal.com-konto.");
  }

  // Find the event type name
  const selectedEventType = eventTypes.find((et) => et.id === body.eventTypeId);

  // Update connection
  const { error: updateError } = await supabase
    .from("calcom_connections")
    .update({
      calcom_event_type_id: String(body.eventTypeId),
      calcom_event_type_name: selectedEventType?.title ?? null,
    })
    .eq("customer_id", customerId);

  if (updateError) throw updateError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.event_type_updated",
    entityType: "customer",
    entityId: customerId,
    metadata: { provider: "calcom", eventTypeId: body.eventTypeId },
  });

  return NextResponse.json({
    eventTypeId: body.eventTypeId,
    eventTypeName: selectedEventType?.title ?? null,
  });
});
