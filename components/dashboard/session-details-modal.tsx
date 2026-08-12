"use client";

import { useEffect, useState } from "react";
import type { ConversationMessage } from "@/types/database";

interface SessionDetailsData {
  widgetName: string | null;
  messages: ConversationMessage[];
  summary: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  user: "Kunde",
  assistant: "AI-assistent",
  system: "System",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TABS = [
  { key: "transcription", label: "Transskription" },
  { key: "summary", label: "Opsummering" },
  { key: "recording", label: "Optagelse" },
  { key: "analysis", label: "Analyse" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function SessionDetailsModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>("transcription");
  const [data, setData] = useState<SessionDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/customer/conversations/${conversationId}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error("Kunne ikke hente samtalen");
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError("Kunne ikke hente samtalen.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Samtaledetaljer</h2>
            {data?.widgetName ? <p className="text-sm text-slate-500">{data.widgetName}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Luk"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-4 pt-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.key
                  ? "border-b-2 border-brand-600 text-brand-700"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <p className="text-sm text-slate-500">Henter…</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {!loading && !error && data ? (
            <>
              {activeTab === "transcription" ? (
                data.messages.length === 0 ? (
                  <p className="text-sm text-slate-500">Ingen beskeder registreret for denne samtale.</p>
                ) : (
                  <div className="space-y-4">
                    {data.messages
                      .filter((m) => m.role !== "system")
                      .map((message) => (
                        <div key={message.id}>
                          <p className="text-xs font-medium text-slate-400">
                            {ROLE_LABEL[message.role] ?? message.role} · {formatDate(message.created_at)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{message.content}</p>
                        </div>
                      ))}
                  </div>
                )
              ) : null}

              {activeTab === "summary" ? (
                data.summary ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{data.summary}</p>
                ) : (
                  <p className="text-sm text-slate-500">Ingen opsummering endnu — samtalen er muligvis for kort.</p>
                )
              ) : null}

              {activeTab === "recording" ? (
                <p className="text-sm text-slate-500">
                  Der gemmes ingen lydoptagelse i denne udgave — kun tekst-transskription.
                </p>
              ) : null}

              {activeTab === "analysis" ? (
                <p className="text-sm text-slate-500">
                  Automatisk samtaleanalyse er ikke tilgængelig endnu.{" "}
                  <span className="font-medium text-brand-600">Kommer snart.</span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
