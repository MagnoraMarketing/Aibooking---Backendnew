import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, profileLanguageInputSchema } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Unlike /api/customer/profile (customer-admin only, edits the company's
// own name/full_name), this is the shared Dashboard/Admin UI language
// preference — any signed-in user, either role, has their own.
export const PATCH = withErrorHandling(async (request) => {
  const ctx = await requireAuth();
  const body = await readJsonBody(request, profileLanguageInputSchema);
  const supabase = getAdminClient();

  const { error } = await supabase.from("profiles").update({ language: body.language }).eq("id", ctx.userId);
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "profile.language_updated",
    metadata: { language: body.language },
  });

  return NextResponse.json({ language: body.language });
});
