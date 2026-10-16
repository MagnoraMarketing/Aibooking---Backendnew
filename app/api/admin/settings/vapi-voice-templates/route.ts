import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, writeAuditLog, vapiVoiceTemplatesInputSchema } from "@/lib/security";
import {
  getVapiVoiceTemplateAssistantId,
  setVapiVoiceTemplateAssistantId,
} from "@/lib/settings/platform";
import { getAdminClient } from "@/lib/database/admin";
import { getVapiAssistantDetails } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

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

// Every new agent is cloned from these two assistants, so a wrong id is not
// a cosmetic mistake: a typo silently drops every agent back to the built-in
// fallback voice, and pointing a template at a customer's own assistant
// would make every other customer's agent a copy of theirs — and have that
// customer's next save overwrite the template. Both are refused here, before
// anything is stored.
async function assertUsableTemplate(label: string, assistantId: string): Promise<void> {
  let found = false;
  try {
    found = Boolean(await getVapiAssistantDetails(assistantId));
  } catch {
    found = false;
  }
  if (!found) {
    throw ApiError.badRequest(`${label}: Vapi kender ingen assistent med ID'et ${assistantId}.`);
  }

  const supabase = getAdminClient();
  for (const key of ["vapiAssistantId", "vapiOutboundAssistantId"]) {
    const { data, error } = await supabase
      .from("widget_settings")
      .select("widget_id")
      .eq(`extra->>${key}`, assistantId)
      .limit(1);
    if (error) throw error;
    if ((data ?? []).length > 0) {
      throw ApiError.conflict(
        `${label}: denne Vapi-assistent tilhører allerede en kundes agent og kan ikke bruges som skabelon.`
      );
    }
  }
}

export const PUT = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, vapiVoiceTemplatesInputSchema);

  if (body.maleAssistantId) await assertUsableTemplate("Mand", body.maleAssistantId);
  if (body.femaleAssistantId) await assertUsableTemplate("Dame", body.femaleAssistantId);

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
