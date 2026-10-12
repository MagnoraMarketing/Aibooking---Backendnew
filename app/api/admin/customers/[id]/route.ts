import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, updateCustomerSchema } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) throw error;
  if (!customer) throw ApiError.notFound("Customer not found");

  const [{ data: widgets }, { data: subscription }, { data: creditAccount }] = await Promise.all([
    supabase.from("widgets").select("*").eq("customer_id", params.id),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("customer_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("credit_accounts").select("*").eq("customer_id", params.id).maybeSingle(),
  ]);

  return NextResponse.json({ customer, widgets, subscription, creditAccount });
});

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, updateCustomerSchema);
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("customers")
    .update(body)
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Customer not found");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: params.id,
    action: "customer.updated",
    entityType: "customer",
    entityId: params.id,
    metadata: body,
  });

  return NextResponse.json({ customer: data });
});

// Soft delete on the customer row — preserves usage/billing history for
// accounting. The login(s) are hard-deleted, though: without that, the
// email stays registered in Supabase Auth forever and can never sign up
// again (self-signup and admin invites both reject an email already in
// auth.users). Deleting the auth user cascades to its `profiles` row
// (profiles.id -> auth.users.id on delete cascade), so nothing extra needs
// deleting there.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("customers")
    .update({ status: "deleted" })
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Customer not found");

  await supabase.from("widgets").update({ status: "paused" }).eq("customer_id", params.id);

  const { data: profiles } = await supabase.from("profiles").select("id").eq("customer_id", params.id);

  let removedLogins = 0;
  for (const profile of profiles ?? []) {
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(profile.id);
    if (deleteUserError) {
      console.error(`Failed to delete auth user ${profile.id} for customer ${params.id}:`, deleteUserError);
      continue;
    }
    removedLogins += 1;
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: params.id,
    action: "customer.deleted",
    entityType: "customer",
    entityId: params.id,
    metadata: { removedLogins, totalLogins: profiles?.length ?? 0 },
  });

  return NextResponse.json({ success: true });
});
