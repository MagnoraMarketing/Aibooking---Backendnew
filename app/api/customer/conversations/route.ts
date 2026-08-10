import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const { searchParams } = new URL(request.url);
  const widgetId = searchParams.get("widgetId");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);

  let query = supabase
    .from("conversations")
    .select("*")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (widgetId) query = query.eq("widget_id", widgetId);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ conversations: data });
});
