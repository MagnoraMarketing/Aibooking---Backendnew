import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  widgetUpdateSchema,
  widgetExtraSettingsSchema,
  requireParam,
} from "@/lib/security";
import { widgetUpdateToDbRow, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const patchWidgetSchema = widgetUpdateSchema.extend({
  extra: widgetExtraSettingsSchema.optional(),
});

async function loadOwnWidget(supabase: ReturnType<typeof getAdminClient>, widgetId: string, customerId: string) {
  const { data, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  return data;
}

async function loadWidgetSettingsExtra(
  supabase: ReturnType<typeof getAdminClient>,
  widgetId: string
): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return (data?.extra as Record<string, unknown> | null) ?? {};
}

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const widget = await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);
  const extra = await loadWidgetSettingsExtra(supabase, widgetId);

  return NextResponse.json({
    widget: {
      ...widget,
      shareUrl: buildShareUrl(widget.public_id),
      embedSnippet: buildEmbedSnippet(widget.public_id),
      extra,
    },
  });
});

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, patchWidgetSchema);
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const { extra: extraUpdate, ...widgetFields } = body;

  await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);

  if (widgetFields.llmModelId) {
    const { data: model } = await supabase
      .from("llm_models")
      .select("id")
      .eq("id", widgetFields.llmModelId)
      .eq("active", true)
      .maybeSingle();
    if (!model) throw ApiError.badRequest("Selected LLM model is not available");
  }

  if (widgetFields.voiceModelId) {
    const { data: voice } = await supabase
      .from("voice_models")
      .select("id")
      .eq("id", widgetFields.voiceModelId)
      .eq("active", true)
      .maybeSingle();
    if (!voice) throw ApiError.badRequest("Selected voice is not available");
  }

  const dbRow = widgetUpdateToDbRow(widgetFields as z.infer<typeof widgetUpdateSchema>);
  const { data, error } =
    Object.keys(dbRow).length > 0
      ? await supabase.from("widgets").update(dbRow).eq("id", widgetId).select("*").single()
      : await supabase.from("widgets").select("*").eq("id", widgetId).single();

  if (error) throw error;

  let extra = await loadWidgetSettingsExtra(supabase, widgetId);
  if (extraUpdate) {
    extra = { ...extra, ...extraUpdate };
    await supabase.from("widget_settings").upsert({ widget_id: widgetId, extra });
  }

  // Keep the linked Vapi assistant (see lib/vapi/sync.ts) in sync whenever
  // anything it depends on changes — the assistant id itself (just set
  // above), or the name/prompt/opening message it was created from.
  // Best-effort: a Vapi hiccup shouldn't block saving the rest of the
  // widget's settings, unlike creation (app/api/customer/widgets/route.ts),
  // where an unprovisioned assistant means the agent can never take a call.
  const relevantFieldsChanged =
    widgetFields.name !== undefined || widgetFields.systemPrompt !== undefined || widgetFields.openingMessage !== undefined;

  if (relevantFieldsChanged || extraUpdate?.vapiAssistantId !== undefined) {
    await syncWidgetToVapiAssistant(data, extra);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "widget.updated",
    entityType: "widget",
    entityId: widgetId,
    metadata: body,
  });

  return NextResponse.json({
    widget: { ...data, shareUrl: buildShareUrl(data.public_id), embedSnippet: buildEmbedSnippet(data.public_id), extra },
  });
});
