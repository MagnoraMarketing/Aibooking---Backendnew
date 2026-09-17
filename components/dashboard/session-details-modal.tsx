"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConversationMessage } from "@/types/database";
import { useTranslation } from "@/components/i18n/language-provider";

// A voice call's turns. They do not come from conversation_messages —
// nothing on our side is on the line to write them — but from the
// end-of-call-report Vapi sends when the call ends.
interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  secondsFromStart: number | null;
}

// What a phone call was: who was rung, when, for how long and how it ended.
// Only an outbound campaign call sends this — an inbound conversation has a
// conversation row of its own carrying the same facts, and its endpoint
// leaves the field out entirely.
interface CallFacts {
  contactName: string | null;
  company: string | null;
  phoneNumber: string;
  status: string;
  attempts: number;
  startedAt: string | null;
  durationSeconds: number;
  endedReason: string | null;
  failureReason: string | null;
  vapiCallId: string | null;
}

interface SessionDetailsData {
  widgetName: string | null;
  messages: ConversationMessage[];
  transcript: TranscriptLine[];
  recordingUrl: string | null;
  summary: string | null;
  call?: CallFacts | null;
}

function formatOffset(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} sek` : `${seconds} sek`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type TabKey = "transcription" | "summary" | "recording" | "analysis";

// Opened for a widget or phone conversation by its id, or — for an outbound
// campaign contact, which has no conversation row — by the endpoint that
// answers in the same shape. Same tabs, same transcript, same recording
// player either way: the data is the same end-of-call-report.
interface SessionDetailsModalProps {
  conversationId?: string;
  source?: string;
  onClose: () => void;
}

export function SessionDetailsModal({ conversationId, source, onClose }: SessionDetailsModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>("transcription");
  const [data, setData] = useState<SessionDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ROLE_LABEL: Record<string, string> = useMemo(
    () => ({
      user: t("dashboardPages.shared.roleCustomer"),
      assistant: t("dashboardPages.shared.roleAssistant"),
      system: t("dashboardPages.shared.roleSystem"),
    }),
    [t]
  );

  const TABS = useMemo(
    () =>
      [
        { key: "transcription", label: t("dashboardPages.session-details-modal.tabTranscription") },
        { key: "summary", label: t("dashboardPages.session-details-modal.tabSummary") },
        { key: "recording", label: t("dashboardPages.session-details-modal.tabRecording") },
        { key: "analysis", label: t("dashboardPages.session-details-modal.tabAnalysis") },
      ] as const,
    [t]
  );

  const endpoint = source ?? `/api/customer/conversations/${conversationId}/messages`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(endpoint)
      .then((res) => {
        if (!res.ok) throw new Error(t("dashboardPages.session-details-modal.loadError"));
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(t("dashboardPages.session-details-modal.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, t]);

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
            <h2 className="text-lg font-semibold text-slate-900">
              {t("dashboardPages.session-details-modal.title")}
            </h2>
            {data?.widgetName ? <p className="text-sm text-slate-500">{data.widgetName}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {data?.call ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-slate-200 bg-slate-50 px-6 py-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-400">{t("dashboardPages.outbound.colName")}</dt>
              <dd className="text-slate-800">
                {data.call.contactName || data.call.phoneNumber}
                {data.call.company ? <span className="text-slate-500"> · {data.call.company}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">{t("dashboardPages.outbound.colPhone")}</dt>
              <dd className="text-slate-800">{data.call.phoneNumber}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">
                {t("dashboardPages.session-details-modal.callTime")}
              </dt>
              <dd className="text-slate-800">
                {data.call.startedAt ? formatDate(data.call.startedAt) : t("dashboardPages.outbound.notCalledYet")}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">
                {t("dashboardPages.session-details-modal.callDuration")}
              </dt>
              <dd className="text-slate-800">{formatDuration(data.call.durationSeconds)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">
                {t("dashboardPages.session-details-modal.callStatus")}
              </dt>
              <dd className="text-slate-800">
                {t(`dashboardPages.outbound.contactStatus.${data.call.status}`)}
                {data.call.attempts > 1
                  ? ` · ${t("dashboardPages.outbound.attemptsValue", { count: data.call.attempts })}`
                  : ""}
              </dd>
            </div>
            {data.call.endedReason ? (
              <div>
                <dt className="text-xs font-medium text-slate-400">
                  {t("dashboardPages.session-details-modal.callResult")}
                </dt>
                <dd className="text-slate-800">{data.call.endedReason}</dd>
              </div>
            ) : null}
            {data.call.failureReason ? (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t("dashboardPages.session-details-modal.callFailureReason")}
                </dt>
                <dd className="text-red-700">{data.call.failureReason}</dd>
              </div>
            ) : null}
            {data.call.vapiCallId ? (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs font-medium text-slate-400">
                  {t("dashboardPages.session-details-modal.callId")}
                </dt>
                <dd className="font-mono text-xs text-slate-500">{data.call.vapiCallId}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

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
          {loading ? <p className="text-sm text-slate-500">{t("dashboardPages.session-details-modal.loading")}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {!loading && !error && data ? (
            <>
              {activeTab === "transcription" ? (
                data.messages.length > 0 ? (
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
                ) : data.transcript.length > 0 ? (
                  <div className="space-y-4">
                    {data.transcript.map((line, index) => (
                      <div key={index}>
                        <p className="text-xs font-medium text-slate-400">
                          {ROLE_LABEL[line.role] ?? line.role}
                          {line.secondsFromStart !== null ? ` · ${formatOffset(line.secondsFromStart)}` : ""}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{line.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t("dashboardPages.shared.noMessagesForConversation")}</p>
                )
              ) : null}

              {activeTab === "summary" ? (
                data.summary ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{data.summary}</p>
                ) : (
                  <p className="text-sm text-slate-500">{t("dashboardPages.session-details-modal.noSummaryYet")}</p>
                )
              ) : null}

              {activeTab === "recording" ? (
                data.recordingUrl ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio controls preload="none" src={data.recordingUrl} className="w-full" />
                    <a
                      href={data.recordingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm font-medium text-brand-600 hover:underline"
                    >
                      {t("dashboardPages.session-details-modal.downloadRecording")}
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t("dashboardPages.session-details-modal.noRecording")}</p>
                )
              ) : null}

              {activeTab === "analysis" ? (
                <p className="text-sm text-slate-500">
                  {t("dashboardPages.session-details-modal.analysisUnavailable")}{" "}
                  <span className="font-medium text-brand-600">
                    {t("dashboardPages.session-details-modal.analysisComingSoon")}
                  </span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
