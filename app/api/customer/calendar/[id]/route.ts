import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: connection, error: lookupError } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, provider")
    .eq("id", connectionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!connection || connection.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");

  const { error } = await supabase.from("calendar_connections").delete().eq("id", connectionId);
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.disconnected",
    entityType: "calendar_connection",
    entityId: connectionId,
    metadata: { provider: connection.provider },
  });

  return NextResponse.json({ success: true });
});
