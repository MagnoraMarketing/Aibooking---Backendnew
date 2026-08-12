import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { AgentsManager } from "@/components/dashboard/agents-manager";
import type { LLMModel, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AgentListPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();

  const [{ data: widgets }, { data: llmModels }] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", ctx.profile.customer_id!)
      .order("created_at", { ascending: false })
      .returns<Widget[]>(),
    supabase
      .from("llm_models")
      .select("*")
      .eq("active", true)
      .eq("show_in_create_flow", true)
      .order("display_name")
      .returns<LLMModel[]>(),
  ]);

  return <AgentsManager initialWidgets={widgets ?? []} llmModels={llmModels ?? []} />;
}
