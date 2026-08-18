import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Lists every connected calendar across all of the customer's agents. Never
// returns access_token/refresh_token/calcom_api_key — those stay
// server-side only (used from lib/calendar, never rendered to the browser).
export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("calendar_connections")
    .select("id, widget_id, provider, status, external_account_email, calendar_id, calcom_event_type_id, created_at")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return NextResponse.json({ connections: data });
});
