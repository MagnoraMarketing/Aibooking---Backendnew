import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, writeAuditLog } from "@/lib/security";
import { getTrialSettings, setTrialSettings, MAX_TRIAL_MINUTES } from "@/lib/settings/platform";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The free trial new customers start with. Master admin only — the internal
// note in particular must never reach a customer.
const schema = z.object({
  minutes: z.number().int().min(0).max(MAX_TRIAL_MINUTES),
  internalNote: z.string().trim().max(2000),
});

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  return NextResponse.json(await getTrialSettings());
});

export const PUT = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, schema);
  await setTrialSettings(body);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "trial_settings.updated",
    metadata: { minutes: body.minutes },
  });

  return NextResponse.json(body);
});
