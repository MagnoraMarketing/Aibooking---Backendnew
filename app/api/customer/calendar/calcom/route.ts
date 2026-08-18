import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, calcomConnectInputSchema } from "@/lib/security";
import { fetchCalcomEventTypes } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Cal.com connects with a pasted API key instead of OAuth (see
// lib/calendar/calcom.ts) — no redirect round-trip needed.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, calcomConnectInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const eventTypes = await fetchCalcomEventTypes(body.apiKey);
  const [firstEventType] = eventTypes;
  if (!firstEventType) {
    throw ApiError.badRequest("Ingen event-typer fundet på jeres Cal.com-konto. Opret en event-type på Cal.com først.");
  }

  const eventTypeId = body.eventTypeId ?? firstEventType.id;
  if (!eventTypes.some((eventType) => eventType.id === eventTypeId)) {
    throw ApiError.badRequest("Den valgte event-type findes ikke på jeres Cal.com-konto.");
  }

  const { data: connection, error } = await supabase
    .from("calendar_connections")
    .upsert(
      {
        customer_id: customerId,
        widget_id: widget.id,
        provider: "calcom",
        status: "connected",
        calcom_api_key: body.apiKey,
        calcom_event_type_id: String(eventTypeId),
      },
      { onConflict: "widget_id,provider" }
    )
    .select("id, widget_id, provider, status, calcom_event_type_id, created_at")
    .single();
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.connected",
    entityType: "widget",
    entityId: widget.id,
    metadata: { provider: "calcom" },
  });

  return NextResponse.json({ connection }, { status: 201 });
});
