import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, voiceModelInputSchema } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("voice_models").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return NextResponse.json({ voiceModels: data });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, voiceModelInputSchema);
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("voice_models")
    .insert({
      provider: body.provider,
      provider_voice_id: body.providerVoiceId,
      name: body.name,
      language: body.language,
      gender: body.gender,
      active: body.active,
      is_default: body.isDefault,
    })
    .select("*")
    .single();

  if (error) throw error;

  if (body.isDefault) {
    await supabase.from("voice_models").update({ is_default: false }).neq("id", data.id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "voice_model.created",
    entityType: "voice_model",
    entityId: data.id,
  });

  return NextResponse.json({ voiceModel: data }, { status: 201 });
});
