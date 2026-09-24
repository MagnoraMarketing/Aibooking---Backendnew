"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Lead } from "@/types/database";
import {
  CALL_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  browserTimeZone,
  dispositionLabel,
  formatDateTime,
  formatDuration,
  localInputToIso,
} from "./labels";
import { errorMessageOf, inputClass, primaryButtonClass, secondaryButtonClass } from "./download";

interface LeadCall {
  id: string;
  from_number: string;
  to_number: string;
  status: string;
  duration_seconds: number | null;
  recording_status: string | null;
  has_recording: boolean;
  outcome: string | null;
  notes: string | null;
  started_at: string;
}

interface LeadDetailProps {
  listId: string;
  leadId: string;
  lists: { id: string; name: string }[];
  canCall: boolean;
  onClose: () => void;
  onChanged: (lead: Lead, movedAway: boolean) => void;
  onCall: (lead: Lead) => void;
}

// A lead's page: who they are, where they stand, and every call placed to
// them, with recordings where one was made.
export function LeadDetail({ listId, leadId, lists, canCall, onClose, onChanged, onCall }: LeadDetailProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [calls, setCalls] = useState<LeadCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ contactName: "", company: "", email: "", notes: "" });
  const [callbackAt, setCallbackAt] = useState("");
  const [moveTo, setMoveTo] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/customer/lead-lists/${listId}/leads/${leadId}`);
    if (!res.ok) {
      setError(await errorMessageOf(res, "Kunne ikke hente leadet."));
      return;
    }
    const data = (await res.json()) as { lead: Lead; calls: LeadCall[] };
    setLead(data.lead);
    setCalls(data.calls);
    setForm({
      contactName: data.lead.contact_name ?? "",
      company: data.lead.company ?? "",
      email: data.lead.email ?? "",
      notes: data.lead.notes ?? "",
    });
  }, [listId, leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A recording arrives a little after the call ends; keep looking while
  // one is still on its way.
  useEffect(() => {
    const waiting = calls.some((c) => !c.recording_status && c.status === "completed" && Date.now() - Date.parse(c.started_at) < 10 * 60_000);
    if (!waiting) return;
    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [calls, load]);

  async function patch(body: Record<string, unknown>, successMovedAway = false) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/customer/lead-lists/${listId}/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError(await errorMessageOf(res, "Kunne ikke gemme."));
      return;
    }
    const { lead: updated } = (await res.json()) as { lead: Lead };
    setLead(updated);
    onChanged(updated, successMovedAway);
    if (successMovedAway) onClose();
  }

  if (!lead) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-slate-500">{error ?? "Indlæser…"}</p>
      </Shell>
    );
  }

  const customEntries = Object.entries(lead.custom_data ?? {});

  return (
    <Shell onClose={onClose}>
      <div className="space-y-6">
        <div>
          <p className="text-xl font-semibold text-slate-900">{lead.contact_name || "Ukendt navn"}</p>
          {lead.company ? <p className="text-sm text-slate-500">{lead.company}</p> : null}
          <p className="mt-1 font-mono text-sm text-slate-700">{lead.phone_number}</p>
          {lead.email ? <p className="text-sm text-slate-600">{lead.email}</p> : null}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd className="font-medium text-slate-800">{LEAD_STATUS_LABELS[lead.status] ?? lead.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Udfald</dt>
            <dd className="font-medium text-slate-800">{dispositionLabel(lead.disposition) || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Forsøg</dt>
            <dd className="font-medium text-slate-800">{lead.attempt_count ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Næste opkald</dt>
            <dd className="font-medium text-slate-800">{lead.next_call_at ? formatDateTime(lead.next_call_at) : "—"}</dd>
          </div>
          {customEntries.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs text-slate-500">{key}</dt>
              <dd className="text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>

        {lead.notes && !editing ? <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{lead.notes}</p> : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {canCall && lead.status !== "do_not_call" ? (
            <button type="button" onClick={() => onCall(lead)} className={primaryButtonClass}>
              📞 Ring op
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing((v) => !v)} className={secondaryButtonClass}>
            {editing ? "Luk redigering" : "Rediger"}
          </button>
          {lead.status !== "do_not_call" ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (window.confirm("Markér som 'må ikke ringes op'? Nummeret kommer på spærrelisten og ringes aldrig op igen.")) {
                  void patch({ disposition: "do_not_call" });
                }
              }}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Må ikke ringes op
            </button>
          ) : null}
        </div>

        {editing ? (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
            <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Navn" className={inputClass} />
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Firma" className={inputClass} />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="E-mail" className={`${inputClass} sm:col-span-2`} />
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Noter" rows={3} className={`${inputClass} sm:col-span-2`} />
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void patch({ ...form, notes: form.notes || null }).then(() => setEditing(false))}
                className={primaryButtonClass}
              >
                Gem
              </button>
            </div>
          </div>
        ) : null}

        {lead.status !== "do_not_call" ? (
          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">Planlæg tilbagekald</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className={`${inputClass} w-auto`} />
              <button
                type="button"
                disabled={saving || !callbackAt}
                onClick={() => void patch({ callbackAt: localInputToIso(callbackAt) })}
                className={secondaryButtonClass}
              >
                Gem tilbagekald
              </button>
            </div>
            <p className="text-xs text-slate-500">Tidszone: {browserTimeZone()}</p>
          </div>
        ) : null}

        {lists.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${inputClass} w-auto`}>
              <option value="">Flyt til en anden liste…</option>
              {lists
                .filter((l) => l.id !== listId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            <button type="button" disabled={!moveTo || saving} onClick={() => void patch({ listId: moveTo }, true)} className={secondaryButtonClass}>
              Flyt
            </button>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Opkaldshistorik</h3>
          {calls.length === 0 ? (
            <p className="text-sm text-slate-500">Ingen opkald endnu.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {calls.map((call) => (
                <li key={call.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-700">{formatDateTime(call.started_at)}</span>
                    <span className="text-slate-500">
                      {CALL_STATUS_LABELS[call.status] ?? call.status}
                      {call.duration_seconds ? ` · ${formatDuration(call.duration_seconds)}` : ""}
                    </span>
                  </div>
                  {call.outcome ? <p className="font-medium text-slate-800">{dispositionLabel(call.outcome)}</p> : null}
                  {call.notes ? <p className="text-slate-600">{call.notes}</p> : null}
                  {call.has_recording ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio controls preload="none" src={`/api/customer/dialer/calls/${call.id}/recording`} className="mt-1 w-full" />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-800">
            Luk ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
