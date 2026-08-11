import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const updateProfileSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
});

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", ctx.profile.customer_id!)
    .single();

  if (error) throw error;

  return NextResponse.json({ profile: ctx.profile, customer });
});

export const PATCH = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, updateProfileSchema);
  const supabase = getAdminClient();

  if (body.companyName) {
    await supabase.from("customers").update({ name: body.companyName }).eq("id", ctx.profile.customer_id!);
  }

  if (body.fullName) {
    await supabase.from("profiles").update({ full_name: body.fullName }).eq("id", ctx.userId);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "customer.profile_updated",
    metadata: body,
  });

  return NextResponse.json({ success: true });
});
