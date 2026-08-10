import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, llmModelUpdateSchema } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, llmModelUpdateSchema);
  const supabase = getAdminClient();

  const row: Record<string, unknown> = {};
  if (body.provider !== undefined) row.provider = body.provider;
  if (body.modelName !== undefined) row.model_name = body.modelName;
  if (body.displayName !== undefined) row.display_name = body.displayName;
  if (body.inputPricePerMillion !== undefined) row.input_price_per_million = body.inputPricePerMillion;
  if (body.outputPricePerMillion !== undefined) row.output_price_per_million = body.outputPricePerMillion;
  if (body.maxTokens !== undefined) row.max_tokens = body.maxTokens;
  if (body.active !== undefined) row.active = body.active;
  if (body.isDefault !== undefined) row.is_default = body.isDefault;

  const { data, error } = await supabase
    .from("llm_models")
    .update(row)
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("LLM model not found");

  if (body.isDefault) {
    await supabase.from("llm_models").update({ is_default: false }).neq("id", data.id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "llm_model.updated",
    entityType: "llm_model",
    entityId: params.id,
    metadata: row,
  });

  return NextResponse.json({ llmModel: data });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("llm_models")
    .update({ active: false })
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("LLM model not found");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "llm_model.deactivated",
    entityType: "llm_model",
    entityId: params.id,
  });

  return NextResponse.json({ success: true });
});
