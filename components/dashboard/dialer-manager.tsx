"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import type { Lead, LeadDisposition } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import type { LeadListRow } from "@/app/dashboard/dialer/page";
import { dialerQueue } from "@/lib/outbound/lead-queue";
import { normalizePhone } from "@/lib/outbound/phone";
import { LeadImportPanel } from "./dialer/lead-import-panel";
import { LeadDetail } from "./dialer/lead-detail";
import { DoNotCallPanel } from "./dialer/do-not-call-panel";
import { errorMessageOf, inputClass, primaryButtonClass, secondaryButtonClass } from "./dialer/download";
import {
  DISPOSITIONS,
  LEAD_STATUS_LABELS,
  browserTimeZone,
  dispositionLabel,
  formatDateTime,
  formatDuration,
  localInputToIso,
} from "./dialer/labels";

interface DialerManagerProps {
  phoneNumbers: PhoneNumberRow[];
  initialLists: LeadListRow[];
}

// Vendored locally since Twilio stopped serving this SDK via CDN as of
// v2.0 (see public/vendor/README.md) — same asset public/widget.js already
// loads for "Twilio Relay" widgets, exposing the browser global
// Twilio.Device. Loaded on demand (not at module load) so the dashboard
// bundle never pulls in browser-only code server-side.
const TWILIO_SDK_PATH = "/vendor/twilio-voice-sdk.min.js";
let twilioSdkPromise: Promise<NonNullable<Window["Twilio"]>> | null = null;

function loadTwilioSdk(): Promise<NonNullable<Window["Twilio"]>> {
  if (twilioSdkPromise) return twilioSdkPromise;
  twilioSdkPromise = new Promise((resolve, reject) => {
    if (window.Twilio?.Device) {
      resolve(window.Twilio);
      return;
    }
    const script = document.createElement("script");
    script.src = TWILIO_SDK_PATH;
    script.async = true;
    script.onload = () => {
      if (window.Twilio?.Device) resolve(window.Twilio);
      else reject(new Error("Telefonen kunne ikke startes i browseren. Genindlæs siden og prøv igen."));
    };
    script.onerror = () => reject(new Error("Telefonen kunne ikke startes i browseren. Genindlæs siden og prøv igen."));
    document.head.appendChild(script);
  });
  return twilioSdkPromise;
}

// The SDK's own messages are English and technical; the customer gets what
// to do about it.
function friendlyCallError(err: { message?: string; code?: number } | undefined): string {
  const message = err?.message ?? "";
  if (err?.code === 31208 || err?.code === 31401 || /permission|notallowed/i.test(message)) {
    return "Giv browseren adgang til mikrofonen for at ringe.";
  }
  if (err?.code === 31005 || err?.code === 31009 || /network|websocket/i.test(message)) {
    return "Forbindelsen til telefonen blev afbrudt. Tjek internetforbindelsen og prøv igen.";
  }
  return "Opkaldet kunne ikke gennemføres. Prøv igen om lidt.";
}

type CallState = "idle" | "connecting" | "ringing" | "in-call" | "wrapup";

const STATE_LABELS: Record<CallState, string> = {
  idle: "Klar",
  connecting: "Forbinder…",
  ringing: "Ringer…",
  "in-call": "I samtale",
  wrapup: "Opkald afsluttet",
};

const AUTO_NEXT_KEY = "aibooking.dialer.autoNext";
const RECORD_KEY = "aibooking.dialer.record";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Private windows without storage just don't remember the switch.
  }
}

export function DialerManager({ phoneNumbers, initialLists }: DialerManagerProps) {
  const [lists, setLists] = useState(initialLists);
  const [showImport, setShowImport] = useState<"new" | "add" | null>(initialLists.length === 0 ? "new" : null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // The lead on the call card — the queue's next one unless the caller
  // picked a specific lead from the table.
  const [pinnedLeadId, setPinnedLeadId] = useState<string | null>(null);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);

  const [phoneNumberId, setPhoneNumberId] = useState(phoneNumbers[0]?.id ?? "");
  const [manualNumber, setManualNumber] = useState("");
  const [autoNext, setAutoNext] = useState(false);
  const [record, setRecord] = useState(false);

  const [callState, setCallState] = useState<CallState>("idle");
  const [callLead, setCallLead] = useState<Lead | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [disposition, setDisposition] = useState<LeadDisposition | "">("");
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [showCallbackForm, setShowCallbackForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Auto-next off: after saving, the finished lead stays on the card until
  // the caller clicks "Næste lead".
  const [awaitingNext, setAwaitingNext] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const callSidRef = useRef<string | null>(null);

  useEffect(() => {
    setAutoNext(readFlag(AUTO_NEXT_KEY));
    setRecord(readFlag(RECORD_KEY));
  }, []);

  useEffect(() => {
    if (callState !== "in-call") return;
    const interval = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [callState]);

  useEffect(() => {
    return () => {
      callRef.current?.disconnect?.();
      deviceRef.current?.destroy?.();
    };
  }, []);

  const queue = useMemo(() => (leads ? dialerQueue(leads, new Date(), skipped) : []), [leads, skipped]);
  const currentLead = useMemo(() => {
    if (!leads) return null;
    if (pinnedLeadId) return leads.find((l) => l.id === pinnedLeadId) ?? queue[0] ?? null;
    return queue[0] ?? null;
  }, [leads, pinnedLeadId, queue]);

  const counts = useMemo(() => {
    const all = leads ?? [];
    return {
      total: all.length,
      called: all.filter((l) => l.status === "called").length,
      remaining: all.filter((l) => l.status === "pending").length,
      callbacks: all.filter((l) => l.status === "callback").length,
      dnc: all.filter((l) => l.status === "do_not_call").length,
    };
  }, [leads]);

  const selectedPhoneNumber = phoneNumbers.find((p) => p.id === phoneNumberId);
  const listOptions = lists.map((l) => ({ id: l.id, name: l.name }));

  function replaceLead(updated: Lead) {
    setLeads((prev) => (prev ? prev.map((l) => (l.id === updated.id ? updated : l)) : prev));
  }

  async function refreshLists() {
    const res = await fetch("/api/customer/lead-lists");
    if (res.ok) setLists(((await res.json()) as { lists: LeadListRow[] }).lists);
  }

  async function selectList(listId: string) {
    setSelectedListId(listId);
    setLoadingList(true);
    setLeads(null);
    setSkipped(new Set());
    setPinnedLeadId(null);
    setAwaitingNext(false);
    setCallError(null);

    const res = await fetch(`/api/customer/lead-lists/${listId}`);
    setLoadingList(false);
    if (!res.ok) return;
    const { leads: loaded } = (await res.json()) as { leads: Lead[] };
    setLeads(loaded);
  }

  async function deleteList(listId: string) {
    if (!window.confirm("Slet listen og alle dens leads? Opkaldshistorikken bevares.")) return;
    const res = await fetch(`/api/customer/lead-lists/${listId}`, { method: "DELETE" });
    if (!res.ok) return;
    setLists((prev) => prev.filter((l) => l.id !== listId));
    if (selectedListId === listId) {
      setSelectedListId(null);
      setLeads(null);
    }
  }

  async function ensureDevice() {
    if (deviceRef.current) return deviceRef.current;

    const res = await fetch("/api/customer/dialer/token", { method: "POST" });
    if (!res.ok) throw new Error(await errorMessageOf(res, "Telefonen kunne ikke forbindes. Prøv igen om lidt."));
    const { token } = (await res.json()) as { token: string };

    const Twilio = await loadTwilioSdk();
    const device = new Twilio.Device(token);
    device.on("tokenWillExpire", async () => {
      const refreshed = await fetch("/api/customer/dialer/token", { method: "POST" });
      if (refreshed.ok) {
        const { token: newToken } = (await refreshed.json()) as { token: string };
        device.updateToken(newToken);
      }
    });
    device.on("error", (err: { message?: string; code?: number }) => {
      console.error("[dialer] device error", err);
      setCallError(friendlyCallError(err));
      setCallState("idle");
    });

    deviceRef.current = device;
    return device;
  }

  async function startCall(lead: Lead | null, to: string) {
    if (!selectedPhoneNumber || callState !== "idle") return;
    setCallError(null);
    setCallState("connecting");
    setCallSeconds(0);
    setIsMuted(false);
    setCallLead(lead);
    setDisposition("");
    setNotes(lead?.notes ?? "");
    setCallbackAt("");
    callSidRef.current = null;

    try {
      const device = await ensureDevice();
      const params: Record<string, string> = {
        To: to,
        CallerId: selectedPhoneNumber.phone_number,
        Record: record ? "true" : "false",
      };
      if (lead) params.LeadId = lead.id;
      const call = await device.connect({ params });
      callRef.current = call;
      if (lead) replaceLead({ ...lead, status: "calling" });

      call.on("ringing", () => setCallState("ringing"));
      call.on("accept", () => {
        callSidRef.current = (call as unknown as { parameters?: { CallSid?: string } }).parameters?.CallSid ?? null;
        setCallState("in-call");
      });
      call.on("disconnect", () => setCallState((s) => (s === "idle" ? "idle" : "wrapup")));
      call.on("cancel", () => setCallState("wrapup"));
      call.on("error", (err: { message?: string; code?: number }) => {
        console.error("[dialer] call error", err);
        setCallError(friendlyCallError(err));
        setCallState("wrapup");
      });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : "Kunne ikke starte opkaldet.");
      setCallState("idle");
      if (lead) replaceLead(lead);
    }
  }

  function callManualNumber() {
    const parsed = normalizePhone(manualNumber, "DK");
    if (!parsed.ok) {
      setCallError("Telefonnummeret er ugyldigt.");
      return;
    }
    void startCall(null, parsed.e164);
  }

  function hangup() {
    callRef.current?.disconnect();
  }

  function toggleMute() {
    const next = !isMuted;
    callRef.current?.mute(next);
    setIsMuted(next);
  }

  function moveOn(finishedLeadId: string | null) {
    setCallState("idle");
    setCallLead(null);
    setShowCallbackForm(false);
    if (!autoNext && finishedLeadId) {
      setPinnedLeadId(finishedLeadId);
      setAwaitingNext(true);
    } else {
      setPinnedLeadId(null);
      setAwaitingNext(false);
    }
  }

  function nextLead() {
    setAwaitingNext(false);
    setPinnedLeadId(null);
  }

  async function patchLead(lead: Lead, body: Record<string, unknown>): Promise<Lead | null> {
    const res = await fetch(`/api/customer/lead-lists/${lead.list_id}/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setCallError(await errorMessageOf(res, "Kunne ikke gemme."));
      return null;
    }
    const { lead: updated } = (await res.json()) as { lead: Lead };
    replaceLead(updated);
    return updated;
  }

  async function saveWrapup() {
    if (!callLead) {
      moveOn(null);
      return;
    }
    if (disposition === "call_back" && !callbackAt) {
      setCallError("Vælg hvornår der skal ringes tilbage.");
      return;
    }
    setSaving(true);
    const updated = await patchLead(callLead, {
      disposition: disposition || "other",
      notes: notes.trim() || null,
      callSid: callSidRef.current,
      ...(disposition === "call_back" ? { callbackAt: localInputToIso(callbackAt) } : {}),
    });
    setSaving(false);
    if (updated) moveOn(updated.id);
  }

  function skipLead(lead: Lead) {
    setSkipped((prev) => new Set(prev).add(lead.id));
    setPinnedLeadId(null);
  }

  async function scheduleCallback(lead: Lead) {
    const iso = localInputToIso(callbackAt);
    if (!iso) {
      setCallError("Vælg dato og tidspunkt for tilbagekaldet.");
      return;
    }
    setSaving(true);
    const updated = await patchLead(lead, { callbackAt: iso });
    setSaving(false);
    if (updated) {
      setShowCallbackForm(false);
      setCallbackAt("");
      setPinnedLeadId(null);
    }
  }

  async function markDoNotCall(lead: Lead) {
    if (!window.confirm("Markér som 'må ikke ringes op'? Nummeret kommer på spærrelisten og ringes aldrig op igen.")) return;
    setSaving(true);
    await patchLead(lead, { disposition: "do_not_call" });
    setSaving(false);
    setPinnedLeadId(null);
  }

  if (phoneNumbers.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dialer</h1>
          <p className="mt-1 text-sm text-slate-500">Ring selv ud til en ringeliste, direkte fra browseren.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Køb et telefonnummer under &quot;Inbound&quot; først &mdash; opkald ringes fra et af jeres egne numre.
        </div>
      </div>
    );
  }

  const leadOnCard = callState === "idle" ? currentLead : callLead;
  const inCall = callState === "connecting" || callState === "ringing" || callState === "in-call";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dialer</h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload en ringeliste og ring selv op, ét opkald ad gangen, direkte fra browseren med mikrofon eller headset.
          </p>
        </div>
        {showImport === null ? (
          <button type="button" onClick={() => setShowImport("new")} className={primaryButtonClass}>
            + Ny ringeliste
          </button>
        ) : null}
      </div>

      {notice ? <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}</p> : null}

      {showImport ? (
        <LeadImportPanel
          lists={listOptions}
          fixedListId={showImport === "add" ? selectedListId : null}
          onCancel={lists.length > 0 ? () => setShowImport(null) : undefined}
          onImported={({ listId, message }) => {
            setShowImport(null);
            setNotice(message);
            void refreshLists();
            void selectList(listId);
          }}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <h2 className="text-lg font-semibold text-slate-900">Ringelister</h2>
          {lists.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Ingen ringelister endnu.</div>
          ) : (
            <ul className="space-y-2">
              {lists.map((list) => (
                <li key={list.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => void selectList(list.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                      selectedListId === list.id ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <p className="pr-10 font-medium text-slate-800">{list.name}</p>
                    <p className="text-xs text-slate-500">{list.leads?.[0]?.count ?? 0} leads</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteList(list.id)}
                    className="absolute right-3 top-3 hidden text-xs text-slate-400 hover:text-red-600 group-hover:block"
                    aria-label={`Slet ${list.name}`}
                  >
                    Slet
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Indstillinger</p>
            <label htmlFor="dialer-from" className="block text-xs font-medium text-slate-600">
              Ring fra (vises for modtageren)
            </label>
            <select
              id="dialer-from"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              disabled={callState !== "idle"}
              className={inputClass}
            >
              {phoneNumbers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label ? `${p.label} (${p.phone_number})` : p.phone_number}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={autoNext}
                onChange={(e) => {
                  setAutoNext(e.target.checked);
                  writeFlag(AUTO_NEXT_KEY, e.target.checked);
                }}
              />
              Åbn automatisk næste lead efter gem
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={record}
                disabled={callState !== "idle"}
                onChange={(e) => {
                  setRecord(e.target.checked);
                  writeFlag(RECORD_KEY, e.target.checked);
                }}
              />
              Optag samtalen
            </label>
            {record ? (
              <p className="text-xs text-amber-700">Husk at fortælle modtageren, at samtalen optages.</p>
            ) : null}
            <div className="border-t border-slate-100 pt-3">
              <label htmlFor="dialer-manual" className="mb-1 block text-xs font-medium text-slate-600">
                Ring til et nummer
              </label>
              <div className="flex gap-2">
                <input
                  id="dialer-manual"
                  value={manualNumber}
                  onChange={(e) => setManualNumber(e.target.value)}
                  placeholder="+45 12 34 56 78"
                  className={inputClass}
                />
                <button type="button" onClick={callManualNumber} disabled={callState !== "idle"} className={secondaryButtonClass}>
                  Ring
                </button>
              </div>
            </div>
          </div>

          <DoNotCallPanel />
        </div>

        <div className="space-y-4 lg:col-span-2">
          {callState !== "idle" && !callLead ? (
            <CallCard
              title={manualNumber}
              state={callState}
              seconds={callSeconds}
              muted={isMuted}
              error={callError}
              onHangup={hangup}
              onMute={toggleMute}
              onDone={() => moveOn(null)}
            />
          ) : null}

          {!selectedListId ? (
            <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Vælg en ringeliste for at starte.
            </div>
          ) : loadingList || !leads ? (
            <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Indlæser…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{counts.total} leads</span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{counts.called} ringet</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">{counts.remaining} tilbage</span>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{counts.callbacks} tilbagekald</span>
                  <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{counts.dnc} spærret</span>
                </div>
                <button type="button" onClick={() => setShowImport("add")} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                  + Tilføj leads til listen
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                {!leadOnCard ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    {skipped.size > 0 ? (
                      <>
                        Ingen flere leads i køen lige nu.{" "}
                        <button type="button" onClick={() => setSkipped(new Set())} className="font-medium text-brand-600">
                          Vis sprungne leads igen
                        </button>
                      </>
                    ) : (
                      "Alle leads på listen er ringet igennem. Planlagte tilbagekald dukker op her, når de er klar."
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {leadOnCard.status === "callback" ? "Tilbagekald" : "Næste lead"}
                        </p>
                        <p className="text-xl font-semibold text-slate-900">{leadOnCard.contact_name || "Ukendt navn"}</p>
                        {leadOnCard.company ? <p className="text-sm text-slate-500">{leadOnCard.company}</p> : null}
                        <p className="mt-1 font-mono text-sm text-slate-700">{leadOnCard.phone_number}</p>
                        {leadOnCard.email ? <p className="text-sm text-slate-600">{leadOnCard.email}</p> : null}
                      </div>
                      <button type="button" onClick={() => setDetailLeadId(leadOnCard.id)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                        Detaljer & historik
                      </button>
                    </div>

                    {Object.keys(leadOnCard.custom_data ?? {}).length > 0 ? (
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        {Object.entries(leadOnCard.custom_data).map(([key, value]) => (
                          <div key={key}>
                            <dt className="text-slate-400">{key}</dt>
                            <dd className="text-slate-700">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {leadOnCard.notes ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{leadOnCard.notes}</p> : null}
                    {leadOnCard.attempt_count > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {leadOnCard.attempt_count} tidligere forsøg
                        {leadOnCard.disposition ? ` · sidst: ${dispositionLabel(leadOnCard.disposition)}` : ""}
                      </p>
                    ) : null}

                    {callError ? <p className="mt-3 text-sm text-red-600">{callError}</p> : null}

                    {callState === "idle" && awaitingNext ? (
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <span className="text-sm text-emerald-700">
                          Gemt{leadOnCard.disposition ? `: ${dispositionLabel(leadOnCard.disposition)}` : ""}.
                        </span>
                        <button type="button" onClick={nextLead} className={primaryButtonClass}>
                          Næste lead →
                        </button>
                      </div>
                    ) : null}

                    {callState === "idle" && !awaitingNext ? (
                      <div className="mt-5 space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void startCall(leadOnCard, leadOnCard.phone_number)}
                            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                          >
                            📞 Ring op
                          </button>
                          <button type="button" onClick={() => skipLead(leadOnCard)} className={secondaryButtonClass}>
                            Spring over
                          </button>
                          <button type="button" onClick={() => setShowCallbackForm((v) => !v)} className={secondaryButtonClass}>
                            Tilbagekald
                          </button>
                          <button
                            type="button"
                            onClick={() => void markDoNotCall(leadOnCard)}
                            disabled={saving}
                            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            Må ikke ringes op
                          </button>
                        </div>
                        {showCallbackForm ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className={`${inputClass} w-auto`} />
                            <button type="button" onClick={() => void scheduleCallback(leadOnCard)} disabled={saving} className={secondaryButtonClass}>
                              Gem tilbagekald
                            </button>
                            <span className="text-xs text-slate-500">{browserTimeZone()}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {inCall ? (
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                          {STATE_LABELS[callState]}
                          {callState === "in-call" ? ` — ${formatDuration(callSeconds)}` : ""}
                        </span>
                        {record && callState === "in-call" ? (
                          <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">● Optager</span>
                        ) : null}
                        <button type="button" onClick={toggleMute} disabled={callState !== "in-call"} className={secondaryButtonClass}>
                          {isMuted ? "Slå lyd til" : "Mute"}
                        </button>
                        <button type="button" onClick={hangup} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                          Læg på
                        </button>
                      </div>
                    ) : null}

                    {callState === "wrapup" && callLead ? (
                      <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
                        <p className="text-sm font-medium text-slate-700">
                          Opkald afsluttet{callSeconds > 0 ? ` (${formatDuration(callSeconds)})` : ""} — hvad blev udfaldet?
                        </p>
                        <select
                          value={disposition}
                          onChange={(e) => setDisposition(e.target.value as LeadDisposition | "")}
                          className={inputClass}
                        >
                          <option value="">Vælg udfald…</option>
                          {DISPOSITIONS.map((d) => (
                            <option key={d.value} value={d.value}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        {disposition === "call_back" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className={`${inputClass} w-auto`} />
                            <span className="text-xs text-slate-500">{browserTimeZone()}</span>
                          </div>
                        ) : null}
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Noter" rows={3} className={inputClass} />
                        <button type="button" onClick={() => void saveWrapup()} disabled={saving} className={primaryButtonClass}>
                          {saving ? "Gemmer…" : autoNext ? "Gem og åbn næste lead →" : "Gem udfald"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Navn</th>
                      <th className="px-4 py-2">Telefon</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Udfald</th>
                      <th className="px-4 py-2">Forsøg</th>
                      <th className="px-4 py-2">Næste opkald</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailLeadId(lead.id)}>
                        <td className="px-4 py-2">
                          <p className="font-medium text-slate-800">{lead.contact_name || "—"}</p>
                          {lead.company ? <p className="text-xs text-slate-500">{lead.company}</p> : null}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{lead.phone_number}</td>
                        <td className="px-4 py-2">{LEAD_STATUS_LABELS[lead.status] ?? lead.status}</td>
                        <td className="px-4 py-2">{dispositionLabel(lead.disposition)}</td>
                        <td className="px-4 py-2">{lead.attempt_count ?? 0}</td>
                        <td className="px-4 py-2 text-xs">{lead.next_call_at ? formatDateTime(lead.next_call_at) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {detailLeadId && selectedListId ? (
        <LeadDetail
          listId={selectedListId}
          leadId={detailLeadId}
          lists={listOptions}
          canCall={callState === "idle"}
          onClose={() => setDetailLeadId(null)}
          onChanged={(updated, movedAway) => {
            if (movedAway) setLeads((prev) => prev?.filter((l) => l.id !== updated.id) ?? prev);
            else replaceLead(updated);
          }}
          onCall={(lead) => {
            setDetailLeadId(null);
            setPinnedLeadId(lead.id);
            setAwaitingNext(false);
            void startCall(lead, lead.phone_number);
          }}
        />
      ) : null}
    </div>
  );
}

// The call card for a number dialled by hand, with no lead behind it.
function CallCard(props: {
  title: string;
  state: CallState;
  seconds: number;
  muted: boolean;
  error: string | null;
  onHangup: () => void;
  onMute: () => void;
  onDone: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="font-mono text-lg text-slate-900">{props.title}</p>
      {props.error ? <p className="mt-2 text-sm text-red-600">{props.error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          {STATE_LABELS[props.state]}
          {props.state === "in-call" ? ` — ${formatDuration(props.seconds)}` : ""}
        </span>
        {props.state === "wrapup" ? (
          <button type="button" onClick={props.onDone} className={secondaryButtonClass}>
            Luk
          </button>
        ) : (
          <>
            <button type="button" onClick={props.onMute} disabled={props.state !== "in-call"} className={secondaryButtonClass}>
              {props.muted ? "Slå lyd til" : "Mute"}
            </button>
            <button type="button" onClick={props.onHangup} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              Læg på
            </button>
          </>
        )}
      </div>
    </div>
  );
}
