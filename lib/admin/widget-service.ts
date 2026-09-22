import "server-only";
import type { z } from "zod";
import { getAdminClient } from "@/lib/database/admin";
import { getOrCreateAibookingCustomerId } from "./aibooking-customer";
import { generatePublicWidgetId, buildShareUrl, buildEmbedSnippet, widgetUpdateToDbRow } from "@/lib/widgets";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { refreshWapiAgent, syncWidgetToVapiAssistant, ensureVapiAssistant, type VapiSyncOutcome } from "@/lib/vapi";
import { attachAssistantToVapiNumber } from "@/lib/vapi";
import { encryptSecret, writeAuditLog } from "@/lib/security";
import { fetchCalcomMe, fetchCalcomEventTypes } from "@/lib/calendar";
import type { createAdminWidgetSchema, wapiAgentConnectionSchema } from "@/lib/security/schemas";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

type CreateInput = z.infer<typeof createAdminWidgetSchema>;
type ConnectionInput = z.infer<typeof wapiAgentConnectionSchema>;

export interface AdminWidgetResult {
  widget: Widget;
  shareUrl: string;
  embedSnippet: string;
  vapiSync: VapiSyncOutcome;
}

// The agent's prompt, greeting, knowledge base and tools are written in
// AIbooking — this pushes them onto its Vapi assistant, so nobody has to
// edit the assistant in Vapi's own dashboard. Without it, an admin-created
// agent kept whatever prompt its Vapi assistant happened to have, and the
// prompt typed here was stored but never used.
//
// createIfMissing: an agent created without picking an existing Vapi
// assistant gets one built from its own prompt. Only on creation — an
// existing agent without one may deliberately run on another model.
//
// Best-effort, like every other sync: a Vapi outage must not lose the agent
// the admin just saved, so the outcome is returned for the UI to show.
export async function pushAdminWidgetToVapi(
  widgetId: string,
  options: { createIfMissing?: boolean } = {}
): Promise<VapiSyncOutcome> {
  const supabase = getAdminClient();
  try {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widgetId)
      .maybeSingle();
    const extra = (settings?.extra as Record<string, unknown> | null) ?? {};

    if (typeof extra.vapiAssistantId !== "string" || !extra.vapiAssistantId) {
      if (!options.createIfMissing) return { status: "skipped", reason: "no_vapi_assistant" };
      // Builds the assistant from the agent's prompt and runs the full sync.
      await ensureVapiAssistant(widgetId);
      return { status: "synced" };
    }

    const { data: widget } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle();
    if (!widget) return { status: "skipped", reason: "widget_not_found" };
    return await syncWidgetToVapiAssistant(widget as Widget, extra);
  } catch (err) {
    console.error(`[admin] Failed to push agent ${widgetId} to Vapi:`, err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

interface ResolvedConnection {
  wapiAgentRowId: string | null;
  vapiAssistantId: string | null;
}

// A local wapi_agents row wins when both are sent (the dropdown is the
// primary path per spec); the manually typed id is the fallback for an
// agent the sync hasn't seen yet — refreshWapiAgent both upserts a cache
// row for it and best-effort live-refreshes its details.
async function resolveWapiAgentConnection(input: {
  wapiAgentId?: string | null;
  wapiAgentExternalId?: string | null;
}): Promise<ResolvedConnection> {
  const supabase = getAdminClient();

  if (input.wapiAgentId) {
    const { data, error } = await supabase
      .from("wapi_agents")
      .select("id, wapi_agent_id")
      .eq("id", input.wapiAgentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw ApiError.notFound("Wapi agent not found");
    return { wapiAgentRowId: data.id as string, vapiAssistantId: data.wapi_agent_id as string };
  }

  if (input.wapiAgentExternalId) {
    const row = await refreshWapiAgent(input.wapiAgentExternalId);
    return { wapiAgentRowId: row.id, vapiAssistantId: row.wapi_agent_id };
  }

  return { wapiAgentRowId: null, vapiAssistantId: null };
}

export async function currentVapiAssistantId(widgetId: string): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  const value = (data?.extra as Record<string, unknown> | null)?.vapiAssistantId;
  return typeof value === "string" ? value : null;
}

// Re-points an already-provisioned Vapi phone number at this widget's
// assistant and moves the phone_numbers row's ownership to it — this is the
// "Tilknyt til agent" action from the admin Phone numbers / Inbound pages,
// not a new-number purchase (see app/api/customer/phone-numbers for that).
export async function attachPhoneNumber(phoneNumberId: string, widget: Widget, vapiAssistantId: string | null): Promise<void> {
  const supabase = getAdminClient();
  const { data: phoneNumber, error } = await supabase
    .from("phone_numbers")
    .select("id, vapi_phone_number_id")
    .eq("id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  if (!phoneNumber) throw ApiError.notFound("Phone number not found");

  if (!phoneNumber.vapi_phone_number_id) {
    throw ApiError.badRequest(
      "Dette nummer er ikke et Vapi-nummer og kan ikke tilknyttes en agent herfra."
    );
  }
  if (!vapiAssistantId) {
    throw ApiError.badRequest("Agenten skal have en Wapi-agent tilknyttet, før et telefonnummer kan pege på den.");
  }

  await attachAssistantToVapiNumber(phoneNumber.vapi_phone_number_id, vapiAssistantId);

  const { error: updateError } = await supabase
    .from("phone_numbers")
    .update({ widget_id: widget.id, customer_id: widget.customer_id })
    .eq("id", phoneNumberId);
  if (updateError) throw updateError;
}

// Connects this agent's calendar straight from the admin Control Center
// (create or edit) — the admin-side counterpart of the customer's own
// "Connect Cal.com" flow (app/api/customer/calendar/calcom/route.ts), which
// this mirrors: validate the key against Cal.com, resolve/verify the event
// type, store the encrypted key, flip widgets.booking_enabled (the single
// gate the runtime reads — see 0030_optional_booking.sql), and push the
// booking tool onto the live Vapi assistant so it's usable immediately.
async function connectAdminCalcom(
  widget: Widget,
  customerId: string,
  apiKey: string,
  eventTypeId: number | undefined,
  actor: { userId: string; role: string }
): Promise<void> {
  const supabase = getAdminClient();

  // Doubles as the "does this key even work" check, same as the customer
  // flow — an invalid key throws here before anything is persisted.
  const [account, eventTypes] = await Promise.all([fetchCalcomMe(apiKey), fetchCalcomEventTypes(apiKey)]);

  const [firstEventType] = eventTypes;
  const resolvedEventTypeId = eventTypeId ?? firstEventType?.id;
  if (!resolvedEventTypeId) {
    throw ApiError.badRequest(
      "Ingen event-typer fundet på Cal.com-kontoen. Opret en event-type på Cal.com, eller indtast event-type ID'et selv."
    );
  }
  if (eventTypes.length > 0 && !eventTypes.some((eventType) => eventType.id === resolvedEventTypeId)) {
    throw ApiError.badRequest("Den angivne Cal.com event-type ID findes ikke på kontoen.");
  }

  const { error: connectionError } = await supabase.from("calendar_connections").upsert(
    {
      customer_id: customerId,
      widget_id: widget.id,
      provider: "calcom",
      status: "connected",
      external_account_email: account.email ?? account.username,
      calcom_api_key: encryptSecret(apiKey),
      calcom_event_type_id: String(resolvedEventTypeId),
      calcom_timezone: account.timezone,
    },
    { onConflict: "widget_id,provider" }
  );
  if (connectionError) throw connectionError;

  const { data: enabledWidget, error: enableError } = await supabase
    .from("widgets")
    .update({ booking_enabled: true })
    .eq("id", widget.id)
    .select("*")
    .single();
  if (enableError) throw enableError;

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widget.id)
    .maybeSingle();
  await syncWidgetToVapiAssistant(enabledWidget, (settings?.extra as Record<string, unknown> | null) ?? {});

  await writeAuditLog({
    actorId: actor.userId,
    actorRole: actor.role,
    customerId,
    action: "calendar_connection.connected",
    entityType: "widget",
    entityId: widget.id,
    metadata: { provider: "calcom", via: "admin" },
  });
}

async function resolveDefaultVapiLlmModelId(): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("llm_models")
    .select("id")
    .eq("provider", "vapi")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// Shared by /api/admin/widgets (Voice Widgets) and /api/admin/inbound
// (agentType forced to "phone" by the caller) — see spec sections 4 and 8:
// picking "AIbooking website" resolves to the reserved internal customer
// instead of trusting a client-sent customerId for it, and a Wapi agent /
// phone number chosen at creation time is wired up in the same request.
export async function createAdminWidget(
  input: CreateInput,
  actor: { userId: string; role: string }
): Promise<AdminWidgetResult> {
  const supabase = getAdminClient();
  const deploymentType = input.deploymentType ?? "customer_website";

  const customerId =
    deploymentType === "aibooking_website" ? await getOrCreateAibookingCustomerId() : input.customerId;
  if (!customerId) {
    throw ApiError.badRequest("customerId er påkrævet, når deployment type er 'customer_website'.");
  }

  const { data: customer } = await supabase.from("customers").select("id").eq("id", customerId).maybeSingle();
  if (!customer) throw ApiError.notFound("Customer not found");

  const systemPrompt = input.systemPrompt ?? (await getDefaultSystemPrompt());

  const {
    wapiAgentId,
    wapiAgentExternalId,
    phoneNumberId,
    deploymentType: _dt,
    calcomApiKey,
    calcomEventTypeId,
    ...rest
  } = input;
  const dbRow = widgetUpdateToDbRow(rest);

  const { wapiAgentRowId, vapiAssistantId } = await resolveWapiAgentConnection({ wapiAgentId, wapiAgentExternalId });

  const llmModelId = rest.llmModelId ?? (vapiAssistantId ? await resolveDefaultVapiLlmModelId() : null);

  const { data: widget, error } = await supabase
    .from("widgets")
    .insert({
      ...dbRow,
      customer_id: customerId,
      public_id: generatePublicWidgetId(),
      name: input.name,
      agent_type: input.agentType,
      deployment_type: deploymentType,
      system_prompt: systemPrompt,
      llm_model_id: llmModelId,
      wapi_agent_id: wapiAgentRowId,
    })
    .select("*")
    .single();
  if (error) throw error;

  await supabase.from("widget_settings").insert({
    widget_id: widget.id,
    extra: vapiAssistantId ? { vapiAssistantId } : {},
  });

  // Prompt first: an agent created without an existing Vapi assistant gets
  // one here, built from the prompt typed in AIbooking — which is also what
  // a phone number below needs to point at. An agent on a model the admin
  // picked explicitly is left alone.
  let vapiSync: VapiSyncOutcome = { status: "skipped", reason: "explicit_llm_model" };
  if (!rest.llmModelId || vapiAssistantId) {
    vapiSync = await pushAdminWidgetToVapi(widget.id, { createIfMissing: true });
  }
  const assistantForPhone = vapiAssistantId ?? (await currentVapiAssistantId(widget.id));

  if (phoneNumberId) {
    await attachPhoneNumber(phoneNumberId, widget as Widget, assistantForPhone);
  }

  if (calcomApiKey) {
    await connectAdminCalcom(widget as Widget, customerId, calcomApiKey, calcomEventTypeId ?? undefined, actor);
  }

  await writeAuditLog({
    actorId: actor.userId,
    actorRole: actor.role,
    customerId,
    action: "admin.widget.created",
    entityType: "widget",
    entityId: widget.id,
    metadata: { deploymentType, agentType: input.agentType },
  });

  const { data: fresh } = await supabase.from("widgets").select("*").eq("id", widget.id).maybeSingle();

  return {
    widget: (fresh ?? widget) as Widget,
    shareUrl: buildShareUrl(widget.public_id),
    embedSnippet: buildEmbedSnippet(widget.public_id),
    vapiSync,
  };
}

// Applies a Wapi agent connection change, a phone number attach and/or a
// Cal.com connect to an EXISTING widget — used by the admin widgets/inbound
// PATCH routes. Returns null when the request touched none of these fields,
// so the caller can skip an audit log entry for a plain field edit.
export async function applyAdminWidgetConnections(
  widget: Widget,
  input: ConnectionInput,
  actor: { userId: string; role: string }
): Promise<ResolvedConnection | null> {
  const touchesAgent = input.wapiAgentId !== undefined || input.wapiAgentExternalId !== undefined;
  if (!touchesAgent && !input.phoneNumberId && !input.calcomApiKey) return null;

  const supabase = getAdminClient();
  let wapiAgentRowId: string | null = null;
  let vapiAssistantId: string | null = null;

  if (touchesAgent) {
    // Both fields null/omitted resolves to {null, null} below, which is
    // exactly a disconnect — no separate branch needed.
    const resolved = await resolveWapiAgentConnection({
      wapiAgentId: input.wapiAgentId,
      wapiAgentExternalId: input.wapiAgentExternalId,
    });
    wapiAgentRowId = resolved.wapiAgentRowId;
    vapiAssistantId = resolved.vapiAssistantId;

    const { error: widgetError } = await supabase
      .from("widgets")
      .update({ wapi_agent_id: wapiAgentRowId })
      .eq("id", widget.id);
    if (widgetError) throw widgetError;

    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widget.id)
      .maybeSingle();
    const extra = { ...((settings?.extra as Record<string, unknown> | null) ?? {}), vapiAssistantId };
    const { error: settingsError } = await supabase.from("widget_settings").upsert({ widget_id: widget.id, extra });
    if (settingsError) throw settingsError;
  } else {
    vapiAssistantId = await currentVapiAssistantId(widget.id);
  }

  if (input.phoneNumberId) {
    await attachPhoneNumber(input.phoneNumberId, widget, vapiAssistantId);
  }

  if (input.calcomApiKey) {
    await connectAdminCalcom(widget, widget.customer_id, input.calcomApiKey, input.calcomEventTypeId ?? undefined, actor);
  }

  return { wapiAgentRowId, vapiAssistantId };
}
