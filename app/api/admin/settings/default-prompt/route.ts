import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, writeAuditLog } from "@/lib/security";
import { getDefaultSystemPrompt, setDefaultSystemPrompt } from "@/lib/settings/platform";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const schema = z.object({ prompt: z.string().trim().min(1).max(8000) });

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const prompt = await getDefaultSystemPrompt();
  return NextResponse.json({ prompt });
});

export const PUT = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, schema);
  await setDefaultSystemPrompt(body.prompt);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "default_system_prompt.updated",
  });

  return NextResponse.json({ prompt: body.prompt });
});
