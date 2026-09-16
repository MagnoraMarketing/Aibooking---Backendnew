import { AgentConfigurePage } from "@/components/dashboard/agent-configure-page";

export const dynamic = "force-dynamic";

// Widget Agents' own URL for configuring an agent. A phone agent that lands
// here is sent on to the Inbound section — see the component for why.
export default async function AgentConfigureRoute({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  return <AgentConfigurePage id={params.id} section="widget" searchParams={searchParams} />;
}
