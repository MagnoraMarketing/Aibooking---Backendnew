import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, packageInputSchema } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("packages").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return NextResponse.json({ packages: data });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, packageInputSchema);
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("packages")
    .insert({
      package_name: body.packageName,
      monthly_price: body.monthlyPrice,
      currency: body.currency,
      included_minutes: body.includedMinutes,
      overage_price_per_minute: body.overagePricePerMinute,
      setup_fee: body.setupFee,
      renewal_type: body.renewalType,
      stripe_price_id: body.stripePriceId,
      active: body.active,
      is_default: body.isDefault,
    })
    .select("*")
    .single();

  if (error) throw error;

  if (body.isDefault) {
    await supabase.from("packages").update({ is_default: false }).neq("id", data.id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "package.created",
    entityType: "package",
    entityId: data.id,
  });

  return NextResponse.json({ package: data }, { status: 201 });
});
