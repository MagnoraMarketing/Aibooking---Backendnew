import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import type { Widget } from "@/types/database";

export const dynamic = "force-dynamic";

// Knowledge base content lives per-agent (widget_settings.extra.knowledgeBase),
// not as one shared pool — the actual upload/paste/link UI is the
// "Knowledge Base" tab inside each agent's Configure Agent page (see
// components/dashboard/agent-tabs/knowledge-base-tab.tsx). This page is just
// a jumping-off point to get there.
export default async function KnowledgeBasePage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();

  const { data: widgets } = await supabase
    .from("widgets")
    .select("*")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false })
    .returns<Widget[]>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Knowledge Base</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload dokumenter, tekst eller links pr. agent, så jeres AI-agenter kan svare mere præcist.
        </p>
      </div>

      {!widgets || widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">I har ikke oprettet nogen agenter endnu.</p>
          <Link
            href="/dashboard/agent"
            className="mt-2 inline-block text-xs font-medium uppercase tracking-wide text-brand-600"
          >
            Opret jeres første agent →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {widgets.map((widget) => (
            <li
              key={widget.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">{widget.name}</p>
                <p className="text-xs text-slate-500">
                  {widget.status === "active" ? "Aktiv" : "Sat på pause"}
                </p>
              </div>
              <Link
                href={`/dashboard/agent/${widget.id}?tab=knowledge`}
                className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Administrér videnbase →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
