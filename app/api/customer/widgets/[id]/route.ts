import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, widgetUpdateSchema, requireParam } from "@/lib/security";
import { widgetUpdateToDbRow, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

async function loadOwnWidget(supabase: ReturnType<typeof getAdminClient>, widgetId: string, customerId: string) {
  const { data, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  return data;
}

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const widget = await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);

  return NextResponse.json({
    widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) },
  });
});

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, widgetUpdateSchema);
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);

  if (body.llmModelId) {
    const { data: model } = await supabase
      .from("llm_models")
      .select("id")
      .eq("id", body.llmModelId)
      .eq("active", true)
      .maybeSingle();
    if (!model) throw ApiError.badRequest("Selected LLM model is not available");
  }

  if (body.voiceModelId) {
    const { data: voice } = await supabase
      .from("voice_models")
      .select("id")
      .eq("id", body.voiceModelId)
      .eq("active", true)
      .maybeSingle();
    if (!voice) throw ApiError.badRequest("Selected voice is not available");
  }

  const { data, error } = await supabase
    .from("widgets")
    .update(widgetUpdateToDbRow(body))
    .eq("id", widgetId)
    .select("*")
    .single();

  if (error) throw error;

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
    widget: { ...data, shareUrl: buildShareUrl(data.public_id), embedSnippet: buildEmbedSnippet(data.public_id) },
  });
});
