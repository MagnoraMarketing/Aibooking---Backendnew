import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  withErrorHandling,
  writeAuditLog,
  requireParam,
  readJsonBody,
  decryptSecret,
  calcomUpdateEventTypeSchema,
  calendarUpdateDurationSchema,
} from "@/lib/security";
import { fetchCalcomEventTypes } from "@/lib/calendar";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const patchSchema = z.union([calcomUpdateEventTypeSchema, calendarUpdateDurationSchema]);

// Lets the customer switch either which Cal.com Event Type the agent books
// against (provider='calcom') or the fixed meeting length it books
// (provider in google/outlook, which have no event-type concept) — without
// disconnecting and reconnecting the calendar.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, patchSchema);

  const { data: connection, error: lookupError } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, provider, calcom_api_key")
    .eq("id", connectionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!connection || connection.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");

  if ("eventTypeId" in body) {
    if (connection.provider !== "calcom" || !connection.calcom_api_key) {
      throw ApiError.badRequest("Denne forbindelse har ikke en valgbar event-type.");
    }

    const apiKey = decryptSecret(connection.calcom_api_key);

    // Validate against the list only when there IS a list. When Cal.com reports
    // none (a team-scoped key, say), the dashboard falls back to letting the
    // customer type the id — and validating an id against an empty list rejects
    // every possible answer, which is the one case where being strict locks the
    // customer out of the setting they came here to fix.
    const eventTypes = await fetchCalcomEventTypes(apiKey).catch(() => [] as Awaited<ReturnType<typeof fetchCalcomEventTypes>>);
    if (eventTypes.length > 0 && !eventTypes.some((eventType) => eventType.id === body.eventTypeId)) {
      throw ApiError.badRequest("Den valgte event-type findes ikke på jeres Cal.com-konto.");
    }

    const { data: updated, error } = await supabase
      .from("calendar_connections")
      .update({ calcom_event_type_id: String(body.eventTypeId) })
      .eq("id", connectionId)
      .select("id, widget_id, provider, status, external_account_email, calcom_event_type_id, calcom_timezone, default_duration_minutes, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ connection: updated });
  }

  if (connection.provider !== "google" && connection.provider !== "outlook") {
    throw ApiError.badRequest("Denne forbindelse har ikke en valgbar varighed.");
  }

  const { data: updated, error } = await supabase
    .from("calendar_connections")
    .update({ default_duration_minutes: body.durationMinutes })
    .eq("id", connectionId)
    .select("id, widget_id, provider, status, external_account_email, calcom_event_type_id, calcom_timezone, default_duration_minutes, created_at")
    .single();
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.duration_updated",
    entityType: "calendar_connection",
    entityId: connectionId,
    metadata: { durationMinutes: body.durationMinutes },
  });

  return NextResponse.json({ connection: updated });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: connection, error: lookupError } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, widget_id, provider")
    .eq("id", connectionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!connection || connection.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");

  const { error } = await supabase.from("calendar_connections").delete().eq("id", connectionId);
  if (error) throw error;

  // The mirror of connecting: Cal.com, Google and Outlook are all booking
  // backends, so removing the last one an agent has must take the booking
  // gate down with it and re-sync the Vapi assistant — otherwise the agent
  // keeps offering to book and every attempt fails at the tool call, which
  // reads worse to a caller than not offering at all. Another calendar still
  // connected to the same agent keeps booking on.
  const remaining = connection.widget_id
    ? await supabase
        .from("calendar_connections")
        .select("id", { count: "exact", head: true })
        .eq("widget_id", connection.widget_id)
        .eq("status", "connected")
        .in("provider", ["calcom", "google", "outlook"])
    : { count: 0 };

  if (connection.widget_id && (remaining.count ?? 0) === 0) {
    const { data: disabledWidget } = await supabase
      .from("widgets")
      .update({ booking_enabled: false })
      .eq("id", connection.widget_id)
      .select("*")
      .single();

    if (disabledWidget) {
      const { data: settings } = await supabase
        .from("widget_settings")
        .select("extra")
        .eq("widget_id", connection.widget_id)
        .maybeSingle();
      await syncWidgetToVapiAssistant(disabledWidget, (settings?.extra as Record<string, unknown> | null) ?? {});
    }
  }

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
