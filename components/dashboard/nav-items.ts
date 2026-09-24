// Every place in the dashboard a customer can go, shared by the desktop top
// bar (header.tsx) and the mobile bottom bar (mobile-bottom-nav.tsx) so the
// two can never list different pages.

export const LEADING_NAV_ITEMS = [
  { key: "dashboardShell.nav.gettingStarted", href: "/dashboard/getting-started" },
  { key: "dashboardShell.nav.dashboard", href: "/dashboard" },
] as const;

// The four agent types (chat widget, inbound/outbound calls, dialer) grouped
// under one "Agenter" menu instead of sitting flat in the nav bar, so they
// read as one family rather than four unrelated items.
export const AGENT_NAV_ITEMS = [
  { key: "dashboardShell.nav.widgetAgents", href: "/dashboard/agent" },
  { key: "dashboardShell.nav.inbound", href: "/dashboard/inbound" },
  { key: "dashboardShell.nav.outbound", href: "/dashboard/outbound" },
  { key: "dashboardShell.nav.dialer", href: "/dashboard/dialer" },
] as const;

export const TRAILING_NAV_ITEMS = [
  { key: "dashboardShell.nav.knowledgeBase", href: "/dashboard/knowledge-base" },
  { key: "dashboardShell.nav.analytics", href: "/dashboard/analytics" },
  { key: "dashboardShell.nav.integrations", href: "/dashboard/integrations" },
  { key: "dashboardShell.nav.billing", href: "/dashboard/billing" },
  { key: "dashboardShell.nav.agency", href: "/dashboard/agency" },
] as const;

export function isActiveNavItem(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}
