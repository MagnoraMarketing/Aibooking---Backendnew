import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { AdminWidgetsTable, type AdminWidgetRow } from "@/components/admin/widgets-table";

export const dynamic = "force-dynamic";

export default async function AdminWidgetsPage() {
  await requireMasterAdminForPage();
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("widgets")
    .select("*, customers(id, name, email), wapi_agents(id, wapi_agent_id, name), phone_numbers(id, phone_number)")
    .eq("agent_type", "widget")
    .order("created_at", { ascending: false });

  const widgets: AdminWidgetRow[] = (data ?? []).map((w) => ({
    ...w,
    shareUrl: buildShareUrl(w.public_id),
    embedSnippet: buildEmbedSnippet(w.public_id),
  }));

  return <AdminWidgetsTable initialWidgets={widgets} />;
}
