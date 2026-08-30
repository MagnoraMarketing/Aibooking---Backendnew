import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

export const dynamic = "force-dynamic";

// Returns Cal.com connection status for the current customer.
// Never returns access_token/refresh_token — those stay server-side only.
export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("calcom_connections")
    .select("calcom_user_id, calcom_username, calcom_email, calcom_event_type_id, calcom_event_type_name, timezone, created_at")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    calcomUserId: data.calcom_user_id,
    username: data.calcom_username,
    email: data.calcom_email,
    eventTypeId: data.calcom_event_type_id,
    eventTypeName: data.calcom_event_type_name,
    timezone: data.timezone,
    connectedAt: data.created_at,
  });
});
