import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const widgetId = searchParams.get("widgetId");
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);

  let query = supabase
    .from("usage_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (customerId) query = query.eq("customer_id", customerId);
  if (widgetId) query = query.eq("widget_id", widgetId);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ usageSessions: data });
});
