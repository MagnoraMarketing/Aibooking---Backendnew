// Where an agent is configured, per section of the dashboard.
//
// Its own module because both sides need it: the server component that
// renders the screen (and redirects an agent opened under the wrong
// section) and the client lists that link to it. Importing it from the
// server component would drag the admin DB client and auth into the
// browser bundle.
//
// See components/dashboard/agent-configure-page.tsx for why a phone agent
// has a URL of its own.
export const AGENT_SECTION_PATHS = {
  widget: "/dashboard/agent",
  inbound: "/dashboard/inbound/agent",
} as const;

export type AgentSection = keyof typeof AGENT_SECTION_PATHS;

export function agentSectionPath(agentType: "widget" | "phone"): string {
  return agentType === "phone" ? AGENT_SECTION_PATHS.inbound : AGENT_SECTION_PATHS.widget;
}
