import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog } from "@/lib/security";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Disconnects Cal.com from the current customer's account.
// Deletes the connection and all stored tokens.
export const POST = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const supabase = getAdminClient();

  const { data: connection, error: fetchError } = await supabase
    .from("calcom_connections")
    .select("id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!connection) {
    throw ApiError.notFound("Cal.com er ikke forbundet");
  }

  // Delete the connection
  const { error: deleteError } = await supabase
    .from("calcom_connections")
    .delete()
    .eq("customer_id", customerId);

  if (deleteError) throw deleteError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.disconnected",
    entityType: "customer",
    entityId: customerId,
    metadata: { provider: "calcom" },
  });

  return NextResponse.json({ disconnected: true }, { status: 200 });
});
