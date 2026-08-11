import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, writeAuditLog, manualCreditAdjustmentSchema } from "@/lib/security";
import { manualAdjustment, getBalanceSeconds } from "@/lib/credits";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, manualCreditAdjustmentSchema);

  const seconds = Math.round(body.minutes * 60);

  await manualAdjustment({
    customerId: body.customerId,
    seconds,
    description: body.description,
    createdBy: ctx.userId,
  });

  const balanceSeconds = await getBalanceSeconds(body.customerId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: body.customerId,
    action: "credits.manual_adjustment",
    entityType: "credit_account",
    entityId: body.customerId,
    metadata: { minutes: body.minutes, description: body.description },
  });

  return NextResponse.json({ balanceSeconds, balanceMinutes: Math.round((balanceSeconds / 60) * 100) / 100 });
});
