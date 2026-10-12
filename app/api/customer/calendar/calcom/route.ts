import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  calcomConnectInputSchema,
  encryptSecret,
  decryptSecret,
} from "@/lib/security";
import { fetchCalcomEventTypes, fetchCalcomMe } from "@/lib/calendar";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// The Cal.com credential another of the customer's agents already books
// with, ready to be put on a second agent.
//
// A calendar belongs to one agent (calendar_connections is unique on
// widget_id, provider), so a customer who adds a phone agent to a widget
// they already set up has to connect Cal.com a second time — and Cal.com
// shows an API key exactly once, so the key they used for the widget is
// gone. Re-pasting is not an option; issuing a second key for the same
// account is busywork. This hands the stored one to the new agent instead.
//
// The key itself never leaves the server: the ciphertext is copied as-is,
// and the plaintext exists only long enough to prove the key still works.
async function credentialFromSibling(connectionId: string, customerId: string, targetWidgetId: string) {
  const supabase = getAdminClient();

  const { data: source, error } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, widget_id, provider, calcom_api_key, calcom_event_type_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw error;
  if (!source || source.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");
  if (source.widget_id === targetWidgetId) {
    throw ApiError.badRequest("Agenten bruger allerede den kalender.");
  }
  if (source.provider !== "calcom" || !source.calcom_api_key) {
    throw ApiError.badRequest("Den valgte forbindelse er ikke en Cal.com-kalender, så den kan ikke genbruges.");
  }

  // The source's event type is the sensible default — same account, same
  // service — and the customer can point this agent at another one
  // afterwards without touching the key (PATCH on the connection).
  const inherited = Number(source.calcom_event_type_id);

  return {
    apiKey: decryptSecret(source.calcom_api_key),
    encryptedApiKey: source.calcom_api_key,
    eventTypeId: Number.isInteger(inherited) && inherited > 0 ? inherited : undefined,
  };
}

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

  const credential = body.fromConnectionId
    ? await credentialFromSibling(body.fromConnectionId, customerId, widget.id)
    : { apiKey: body.apiKey!, encryptedApiKey: encryptSecret(body.apiKey!), eventTypeId: undefined };

  // Doubles as the "test authentication" step the setup flow requires —
  // fetchCalcomMe throws a clear error on an invalid key before anything is
  // persisted. A copied key gets the same check: it was good when the other
  // agent was set up, which says nothing about whether it was revoked since,
  // and finding out now beats finding out on a caller's booking.
  const [account, eventTypes] = await Promise.all([
    fetchCalcomMe(credential.apiKey),
    fetchCalcomEventTypes(credential.apiKey),
  ]);

  // Which event type the agent books against. The customer can name one
  // explicitly (the "Event-type ID" field), otherwise we take the first one
  // their key reports.
  //
  // The key is already proven good at this point — fetchCalcomMe authenticated
  // it. So an empty event-type list is not a reason to refuse the connection
  // when the customer told us the id: a key scoped to a team reports no types
  // here, and refusing left those customers unable to connect a calendar that
  // works fine. We only reject an id we can see is wrong.
  const [firstEventType] = eventTypes;
  const eventTypeId = body.eventTypeId ?? credential.eventTypeId ?? firstEventType?.id;
  if (!eventTypeId) {
    throw ApiError.badRequest(
      "Ingen event-typer fundet på jeres Cal.com-konto. Opret en event-type på Cal.com, eller indtast event-type ID'et selv."
    );
  }
  if (eventTypes.length > 0 && !eventTypes.some((eventType) => eventType.id === eventTypeId)) {
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
        calcom_api_key: credential.encryptedApiKey,
        calcom_event_type_id: String(eventTypeId),
        calcom_timezone: account.timezone,
      },
      { onConflict: "widget_id,provider" }
    )
    .select("id, widget_id, provider, status, external_account_email, calcom_event_type_id, calcom_timezone, created_at")
    .single();
  if (error) throw error;

  // Connecting a calendar is what makes booking real for this agent.
  // widgets.booking_enabled is the single gate the runtime reads (see
  // 0030_optional_booking.sql): the Vapi assistant only carries booking
  // tools when it's on, and the Anthropic tool handler only touches Cal.com
  // when it's on. Until now only an admin completing a booking_setup_request
  // flipped it, so a customer who connected Cal.com themselves ended up with
  // a stored connection and an agent that still couldn't book anything.
  const { data: enabledWidget } = await supabase
    .from("widgets")
    .update({ booking_enabled: true })
    .eq("id", widget.id)
    .select("*")
    .single();

  if (enabledWidget) {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widget.id)
      .maybeSingle();
    await syncWidgetToVapiAssistant(enabledWidget, (settings?.extra as Record<string, unknown> | null) ?? {});
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.connected",
    entityType: "widget",
    entityId: widget.id,
    metadata: { provider: "calcom", reusedFrom: body.fromConnectionId ?? null },
  });

  return NextResponse.json({ connection, eventTypes, bookingEnabled: true }, { status: 201 });
});
