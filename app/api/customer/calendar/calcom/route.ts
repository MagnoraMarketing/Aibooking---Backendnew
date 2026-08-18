import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, calcomConnectInputSchema, encryptSecret } from "@/lib/security";
import { fetchCalcomEventTypes, fetchCalcomMe } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Cal.com connects with a pasted API key instead of OAuth (see
// lib/calendar/calcom.ts) — no redirect round-trip needed. The key is only
// ever handled here and in lib/calendar/calcom.ts's server-side callers —
// encrypted before it touches the database (lib/security/crypto.ts), and
// never selected back into any response this route or the GET list route
// returns.
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

  // Doubles as the "test authentication" step the setup flow requires —
  // fetchCalcomMe throws a clear error on an invalid key before anything is
  // persisted.
  const [account, eventTypes] = await Promise.all([
    fetchCalcomMe(body.apiKey),
    fetchCalcomEventTypes(body.apiKey),
  ]);

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
        external_account_email: account.email ?? account.username,
        calcom_api_key: encryptSecret(body.apiKey),
        calcom_event_type_id: String(eventTypeId),
        calcom_timezone: account.timezone,
      },
      { onConflict: "widget_id,provider" }
    )
    .select("id, widget_id, provider, status, external_account_email, calcom_event_type_id, calcom_timezone, created_at")
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
