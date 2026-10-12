import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog } from "@/lib/security";
import { syncWapiAgents } from "@/lib/vapi";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The cached Wapi (Vapi) agent catalog (spec section 5/17/18) — fast, always
// available even when Vapi itself is down, since it just reads the local
// wapi_agents table. Use POST to actually talk to Vapi and refresh it.
export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase.from("wapi_agents").select("*").order("name", { ascending: true });
  if (error) throw error;

  const lastSyncedAt = (data ?? []).reduce<string | null>((latest, row) => {
    if (!row.last_synced_at) return latest;
    return !latest || row.last_synced_at > latest ? row.last_synced_at : latest;
  }, null);

  return NextResponse.json({ agents: data ?? [], lastSyncedAt });
});

// "Sync Wapi Agents" (spec section 18): pulls every assistant from the
// platform's Vapi account and upserts it into wapi_agents. Never removes a
// row that disappeared upstream — see lib/vapi/agent-sync.ts.
export const POST = withErrorHandling(async () => {
  const ctx = await requireMasterAdmin();
  const result = await syncWapiAgents();

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "wapi_agents.synced",
    metadata: { ...result },
  });

  const supabase = getAdminClient();
  const { data } = await supabase.from("wapi_agents").select("*").order("name", { ascending: true });

  return NextResponse.json({ agents: data ?? [], ...result });
});
