import { requireMasterAdminForPage } from "@/lib/auth";
import { listDashboardAgents } from "@/lib/aibooking-dashboard/service";
import { AibookingDashboard } from "@/components/admin/aibooking-dashboard";

export const dynamic = "force-dynamic";

// Aibooking.dk Dashboard — the platform's own agents (website widget,
// inbound line, later outbound). The agents come from the database; their
// activity is fetched live from Vapi by the client component.
export default async function AibookingDashboardPage() {
  await requireMasterAdminForPage();
  const agents = await listDashboardAgents();
  return <AibookingDashboard initialAgents={agents} />;
}
