import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam, readJsonBody, decryptSecret, calcomUpdateEventTypeSchema } from "@/lib/security";
import { fetchCalcomEventTypes } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Lets the customer switch which Cal.com Event Type the agent books against
// without disconnecting and re-pasting their API key — only meaningful for
// provider='calcom' (Google/Outlook have no event-type concept).
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, calcomUpdateEventTypeSchema);

  const { data: connection, error: lookupError } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, provider, calcom_api_key")
    .eq("id", connectionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!connection || connection.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");
  if (connection.provider !== "calcom" || !connection.calcom_api_key) {
    throw ApiError.badRequest("Denne forbindelse har ikke en valgbar event-type.");
  }

  const apiKey = decryptSecret(connection.calcom_api_key);
  const eventTypes = await fetchCalcomEventTypes(apiKey);
  if (!eventTypes.some((eventType) => eventType.id === body.eventTypeId)) {
    throw ApiError.badRequest("Den valgte event-type findes ikke på jeres Cal.com-konto.");
  }

  const { data: updated, error } = await supabase
    .from("calendar_connections")
    .update({ calcom_event_type_id: String(body.eventTypeId) })
    .eq("id", connectionId)
    .select("id, widget_id, provider, status, external_account_email, calcom_event_type_id, calcom_timezone, created_at")
    .single();
  if (error) throw error;

  return NextResponse.json({ connection: updated });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: connection, error: lookupError } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, provider")
    .eq("id", connectionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!connection || connection.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");

  const { error } = await supabase.from("calendar_connections").delete().eq("id", connectionId);
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.disconnected",
    entityType: "calendar_connection",
    entityId: connectionId,
    metadata: { provider: connection.provider },
  });

  return NextResponse.json({ success: true });
});
