import { AgentConfigurePage } from "@/components/dashboard/agent-configure-page";

export const dynamic = "force-dynamic";

// The same screen as /dashboard/agent/<id>, under Inbound so the top menu
// keeps the customer in the section they opened the agent from.
export default async function InboundAgentConfigureRoute({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  return <AgentConfigurePage id={params.id} section="inbound" searchParams={searchParams} />;
}
