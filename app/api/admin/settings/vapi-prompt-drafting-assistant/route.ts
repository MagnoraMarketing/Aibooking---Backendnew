import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, writeAuditLog, vapiPromptDraftingAssistantInputSchema } from "@/lib/security";
import { getVapiPromptDraftingAssistantId, setVapiPromptDraftingAssistantId } from "@/lib/settings/platform";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const assistantId = await getVapiPromptDraftingAssistantId();
  return NextResponse.json({ assistantId });
});

export const PUT = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, vapiPromptDraftingAssistantInputSchema);

  await setVapiPromptDraftingAssistantId(body.assistantId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "vapi_prompt_drafting_assistant.updated",
  });

  const assistantId = await getVapiPromptDraftingAssistantId();
  return NextResponse.json({ assistantId });
});
