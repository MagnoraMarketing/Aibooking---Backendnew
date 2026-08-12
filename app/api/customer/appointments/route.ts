import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("appointment_time", { ascending: false })
    .limit(10);

  if (error) throw error;

  return NextResponse.json({ appointments: data });
});
