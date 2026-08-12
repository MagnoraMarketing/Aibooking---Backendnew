import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import type { Conversation, ConversationMessage, ConversationSummary, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ROLE_LABEL: Record<string, string> = {
  user: "Kunde",
  assistant: "AI-assistent",
  system: "System",
};

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<Conversation>();

  if (!conversation || conversation.customer_id !== ctx.profile.customer_id) {
    notFound();
  }

  const [{ data: widget }, { data: messages }, { data: summaries }] = await Promise.all([
    supabase.from("widgets").select("*").eq("id", conversation.widget_id).maybeSingle<Widget>(),
    supabase
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .returns<ConversationMessage[]>(),
    supabase
      .from("conversation_summaries")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<ConversationSummary[]>(),
  ]);

  const latestSummary = summaries?.[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Tilbage til dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{widget?.name ?? "Samtale"}</h1>
        <p className="mt-1 text-sm text-slate-500">{formatDate(conversation.started_at)}</p>
      </div>

      {latestSummary ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Opsummering</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{latestSummary.summary}</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Transskription
        </h2>
        <div className="space-y-4 p-5">
          {(messages ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">Ingen beskeder registreret for denne samtale.</p>
          ) : (
            (messages ?? [])
              .filter((message) => message.role !== "system")
              .map((message) => (
                <div key={message.id}>
                  <p className="text-xs font-medium text-slate-400">
                    {ROLE_LABEL[message.role] ?? message.role} · {formatDate(message.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{message.content}</p>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
