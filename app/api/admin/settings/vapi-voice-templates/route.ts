import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, writeAuditLog, vapiVoiceTemplatesInputSchema } from "@/lib/security";
import {
  getVapiVoiceTemplateAssistantId,
  setVapiVoiceTemplateAssistantId,
} from "@/lib/settings/platform";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const [maleAssistantId, femaleAssistantId] = await Promise.all([
    getVapiVoiceTemplateAssistantId("male"),
    getVapiVoiceTemplateAssistantId("female"),
  ]);
  return NextResponse.json({ maleAssistantId, femaleAssistantId });
});

export const PUT = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, vapiVoiceTemplatesInputSchema);

  if (body.maleAssistantId !== undefined) {
    await setVapiVoiceTemplateAssistantId("male", body.maleAssistantId);
  }
  if (body.femaleAssistantId !== undefined) {
    await setVapiVoiceTemplateAssistantId("female", body.femaleAssistantId);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "vapi_voice_templates.updated",
  });

  const [maleAssistantId, femaleAssistantId] = await Promise.all([
    getVapiVoiceTemplateAssistantId("male"),
    getVapiVoiceTemplateAssistantId("female"),
  ]);
  return NextResponse.json({ maleAssistantId, femaleAssistantId });
});
