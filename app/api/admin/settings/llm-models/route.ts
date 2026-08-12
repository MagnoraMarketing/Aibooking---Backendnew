import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, llmModelInputSchema } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("llm_models").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return NextResponse.json({ llmModels: data });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, llmModelInputSchema);
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("llm_models")
    .insert({
      provider: body.provider,
      model_name: body.modelName,
      display_name: body.displayName,
      input_price_per_million: body.inputPricePerMillion,
      output_price_per_million: body.outputPricePerMillion,
      max_tokens: body.maxTokens,
      active: body.active,
      is_default: body.isDefault,
      show_in_create_flow: body.showInCreateFlow,
    })
    .select("*")
    .single();

  if (error) throw error;

  if (body.isDefault) {
    await supabase.from("llm_models").update({ is_default: false }).neq("id", data.id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "llm_model.created",
    entityType: "llm_model",
    entityId: data.id,
  });

  return NextResponse.json({ llmModel: data }, { status: 201 });
});
