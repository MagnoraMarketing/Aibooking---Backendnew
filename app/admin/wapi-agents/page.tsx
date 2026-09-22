import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { AdminWapiAgentsTable } from "@/components/admin/wapi-agents-table";
import type { WapiAgent } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminWapiAgentsPage() {
  await requireMasterAdminForPage();
  const supabase = getAdminClient();

  const { data } = await supabase.from("wapi_agents").select("*").order("name", { ascending: true }).returns<WapiAgent[]>();

  const lastSyncedAt = (data ?? []).reduce<string | null>((latest, row) => {
    if (!row.last_synced_at) return latest;
    return !latest || row.last_synced_at > latest ? row.last_synced_at : latest;
  }, null);

  return <AdminWapiAgentsTable initialAgents={data ?? []} initialLastSyncedAt={lastSyncedAt} />;
}
