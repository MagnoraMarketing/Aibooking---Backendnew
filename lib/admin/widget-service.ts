import "server-only";
import type { z } from "zod";
import { getAdminClient } from "@/lib/database/admin";
import { getOrCreateAibookingCustomerId } from "./aibooking-customer";
import { generatePublicWidgetId, buildShareUrl, buildEmbedSnippet, widgetUpdateToDbRow } from "@/lib/widgets";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { refreshWapiAgent } from "@/lib/vapi";
import { attachAssistantToVapiNumber } from "@/lib/vapi";
import { writeAuditLog } from "@/lib/security/audit";
import type { createAdminWidgetSchema, wapiAgentConnectionSchema } from "@/lib/security/schemas";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

type CreateInput = z.infer<typeof createAdminWidgetSchema>;
type ConnectionInput = z.infer<typeof wapiAgentConnectionSchema>;

export interface AdminWidgetResult {
  widget: Widget;
  shareUrl: string;
  embedSnippet: string;
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

  const { wapiAgentId, wapiAgentExternalId, phoneNumberId, deploymentType: _dt, ...rest } = input;
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

  if (phoneNumberId) {
    await attachPhoneNumber(phoneNumberId, widget as Widget, vapiAssistantId);
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

  return {
    widget: widget as Widget,
    shareUrl: buildShareUrl(widget.public_id),
    embedSnippet: buildEmbedSnippet(widget.public_id),
  };
}

// Applies a Wapi agent connection change and/or a phone number attach to an
// EXISTING widget — used by the admin widgets/inbound PATCH routes. Returns
// null when the request touched none of these fields, so the caller can
// skip an audit log entry for a plain field edit.
export async function applyAdminWidgetConnections(
  widget: Widget,
  input: ConnectionInput
): Promise<ResolvedConnection | null> {
  const touchesAgent = input.wapiAgentId !== undefined || input.wapiAgentExternalId !== undefined;
  if (!touchesAgent && !input.phoneNumberId) return null;

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

  return { wapiAgentRowId, vapiAssistantId };
}
