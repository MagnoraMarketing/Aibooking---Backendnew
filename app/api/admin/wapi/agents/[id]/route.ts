import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { refreshWapiAgent } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Per-row "View" / "Refresh" (spec section 5) — best-effort live re-fetch
// from Vapi merged into the cache; falls back to the cached row untouched if
// Vapi can't be reached, so this never errors out just because the upstream
// API hiccuped (see refreshWapiAgent).
export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const id = requireParam(params, "id");

  const { data: row, error } = await supabase.from("wapi_agents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) throw ApiError.notFound("Wapi agent not found");

  const refreshed = await refreshWapiAgent(row.wapi_agent_id as string);
  return NextResponse.json({ agent: refreshed });
});
