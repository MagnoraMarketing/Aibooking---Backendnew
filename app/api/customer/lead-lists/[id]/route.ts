import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Fetches a lead list's full lead queue for the dialer UI — the summary
// list on GET /api/customer/lead-lists deliberately doesn't include this
// (500 leads x every column would be wasteful for a page that just needs
// counts).
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const listId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: list, error: listError } = await supabase
    .from("lead_lists")
    .select("*")
    .eq("id", listId)
    .maybeSingle();
  if (listError) throw listError;
  if (!list || list.customer_id !== customerId) throw ApiError.notFound("Lead list not found");

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .eq("list_id", listId)
    .order("created_at", { ascending: true });
  if (leadsError) throw leadsError;

  return NextResponse.json({ list, leads });
});
