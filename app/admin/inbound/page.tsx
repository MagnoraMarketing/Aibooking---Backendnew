import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { AdminInboundTable } from "@/components/admin/inbound-table";
import type { AdminWidgetRow } from "@/components/admin/widgets-table";

export const dynamic = "force-dynamic";

// The admin, cross-customer Inbound page (spec section 7). "Inbound agent"
// is a widgets row with agent_type='phone' — the same table the customer
// dashboard's /dashboard/inbound reads — so this is deliberately the same
// query as /admin/widgets, just filtered the other way.
export default async function AdminInboundPage() {
  await requireMasterAdminForPage();
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("widgets")
    .select("*, customers(id, name, email), wapi_agents(id, wapi_agent_id, name), phone_numbers(id, phone_number)")
    .eq("agent_type", "phone")
    .order("created_at", { ascending: false });

  const agents: AdminWidgetRow[] = (data ?? []).map((w) => ({
    ...w,
    shareUrl: buildShareUrl(w.public_id),
    embedSnippet: buildEmbedSnippet(w.public_id),
  }));

  return <AdminInboundTable initialAgents={agents} />;
}
