import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, packageUpdateSchema } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, packageUpdateSchema);
  const supabase = getAdminClient();

  const row: Record<string, unknown> = {};
  if (body.packageName !== undefined) row.package_name = body.packageName;
  if (body.monthlyPrice !== undefined) row.monthly_price = body.monthlyPrice;
  if (body.currency !== undefined) row.currency = body.currency;
  if (body.includedMinutes !== undefined) row.included_minutes = body.includedMinutes;
  if (body.overagePricePerMinute !== undefined) row.overage_price_per_minute = body.overagePricePerMinute;
  if (body.setupFee !== undefined) row.setup_fee = body.setupFee;
  if (body.renewalType !== undefined) row.renewal_type = body.renewalType;
  if (body.stripePriceId !== undefined) row.stripe_price_id = body.stripePriceId;
  if (body.active !== undefined) row.active = body.active;
  if (body.isDefault !== undefined) row.is_default = body.isDefault;

  const { data, error } = await supabase
    .from("packages")
    .update(row)
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Package not found");

  if (body.isDefault) {
    await supabase.from("packages").update({ is_default: false }).neq("id", data.id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "package.updated",
    entityType: "package",
    entityId: params.id,
    metadata: row,
  });

  return NextResponse.json({ package: data });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("packages")
    .update({ active: false })
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Package not found");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "package.deactivated",
    entityType: "package",
    entityId: params.id,
  });

  return NextResponse.json({ success: true });
});
