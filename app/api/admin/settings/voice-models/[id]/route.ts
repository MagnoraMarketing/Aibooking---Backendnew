import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, voiceModelUpdateSchema } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, voiceModelUpdateSchema);
  const supabase = getAdminClient();

  const row: Record<string, unknown> = {};
  if (body.provider !== undefined) row.provider = body.provider;
  if (body.providerVoiceId !== undefined) row.provider_voice_id = body.providerVoiceId;
  if (body.name !== undefined) row.name = body.name;
  if (body.language !== undefined) row.language = body.language;
  if (body.gender !== undefined) row.gender = body.gender;
  if (body.active !== undefined) row.active = body.active;
  if (body.isDefault !== undefined) row.is_default = body.isDefault;

  const { data, error } = await supabase
    .from("voice_models")
    .update(row)
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Voice model not found");

  if (body.isDefault) {
    await supabase.from("voice_models").update({ is_default: false }).neq("id", data.id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "voice_model.updated",
    entityType: "voice_model",
    entityId: params.id,
    metadata: row,
  });

  return NextResponse.json({ voiceModel: data });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("voice_models")
    .update({ active: false })
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Voice model not found");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "voice_model.deactivated",
    entityType: "voice_model",
    entityId: params.id,
  });

  return NextResponse.json({ success: true });
});
