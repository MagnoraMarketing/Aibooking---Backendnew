import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

export const dynamic = "force-dynamic";

// Cross-customer view for master admin (see /admin/phone-numbers) — status,
// direction, agent and price for every number on the platform, so support
// can spot and retry a failed provisioning without going through Twilio
// Console.
export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("phone_numbers")
    .select("*, customers(name, email), widgets(name)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return NextResponse.json({ phoneNumbers: data });
});
