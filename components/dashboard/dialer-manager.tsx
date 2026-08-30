"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import type { Lead, LeadDisposition } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import type { LeadListRow } from "@/app/dashboard/dialer/page";

interface DialerManagerProps {
  phoneNumbers: PhoneNumberRow[];
  initialLists: LeadListRow[];
}

// One line per lead: "+4512345678" or "+4512345678, Navn" or
// "+4512345678, Navn, Firma".
function parseLeads(raw: string): { phoneNumber: string; name?: string; company?: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phoneNumber, name, company] = line.split(",").map((part) => part.trim());
      return { phoneNumber: phoneNumber ?? "", name: name || undefined, company: company || undefined };
    });
}

const DISPOSITIONS: { value: LeadDisposition; label: string }[] = [
  { value: "booked", label: "Booket møde" },
  { value: "interested", label: "Interesseret — følg op" },
  { value: "not_interested", label: "Ikke interesseret" },
  { value: "call_back", label: "Ring igen senere" },
  { value: "no_answer", label: "Ingen svar" },
  { value: "voicemail", label: "Lagde besked" },
  { value: "wrong_number", label: "Forkert nummer" },
];

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
      else reject(new Error("Twilio Voice SDK blev indlæst, men window.Twilio.Device mangler"));
    };
    script.onerror = () => reject(new Error("Kunne ikke indlæse Twilio Voice SDK"));
    document.head.appendChild(script);
  });
  return twilioSdkPromise;
}

type CallState = "idle" | "connecting" | "in-call" | "wrapup";

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DialerManager({ phoneNumbers, initialLists }: DialerManagerProps) {
  const [lists, setLists] = useState(initialLists);
  const [showUploadForm, setShowUploadForm] = useState(initialLists.length === 0);
  const [uploadName, setUploadName] = useState("");
  const [uploadRaw, setUploadRaw] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phoneNumberId, setPhoneNumberId] = useState(phoneNumbers[0]?.id ?? "");

  const [callState, setCallState] = useState<CallState>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [disposition, setDisposition] = useState<LeadDisposition | "">("");
  const [notes, setNotes] = useState("");
  const [savingWrapup, setSavingWrapup] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);

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

  const currentLead = leads?.[currentIndex] ?? null;
  const calledCount = useMemo(() => leads?.filter((l) => l.status === "called").length ?? 0, [leads]);
  const selectedPhoneNumber = phoneNumbers.find((p) => p.id === phoneNumberId);

  function phoneNumberLabel(p: PhoneNumberRow): string {
    return p.label || p.phone_number;
  }

  async function handleUpload() {
    const parsed = parseLeads(uploadRaw);
    if (!uploadName.trim()) {
      setUploadError("Angiv et navn til listen.");
      return;
    }
    if (parsed.length === 0) {
      setUploadError("Indsæt mindst ét telefonnummer.");
      return;
    }
    if (parsed.length > 500) {
      setUploadError("Maks. 500 leads pr. liste.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const res = await fetch("/api/customer/lead-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: uploadName.trim(), leads: parsed }),
    });

    setUploading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setUploadError(data?.error?.message ?? "Kunne ikke oprette listen.");
      return;
    }

    const { list } = await res.json();
    setLists((prev) => [{ ...list, leads: [{ count: parsed.length }] }, ...prev]);
    setUploadName("");
    setUploadRaw("");
    setShowUploadForm(false);
    void selectList(list.id);
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setUploadRaw((prev) => (prev ? `${prev}\n${text.trim()}` : text.trim()));
    });
    e.target.value = "";
  }

  async function selectList(listId: string) {
    setSelectedListId(listId);
    setLoadingList(true);
    setLeads(null);
    setCallError(null);

    const res = await fetch(`/api/customer/lead-lists/${listId}`);
    setLoadingList(false);
    if (!res.ok) return;

    const { leads: loadedLeads } = (await res.json()) as { leads: Lead[] };
    setLeads(loadedLeads);
    const firstPending = loadedLeads.findIndex((l) => l.status === "pending");
    setCurrentIndex(firstPending === -1 ? 0 : firstPending);
  }

  async function ensureDevice() {
    if (deviceRef.current) return deviceRef.current;

    const res = await fetch("/api/customer/dialer/token", { method: "POST" });
    if (!res.ok) throw new Error("Kunne ikke hente adgangstoken til opkald.");
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
    device.on("error", (err: { message?: string }) => {
      setCallError(err?.message ?? "Der opstod en fejl med telefonforbindelsen.");
      setCallState("idle");
    });

    deviceRef.current = device;
    return device;
  }

  async function startCall() {
    if (!currentLead || !selectedPhoneNumber) return;
    setCallError(null);
    setCallState("connecting");
    setCallSeconds(0);

    try {
      const device = await ensureDevice();
      const call = await device.connect({
        params: {
          To: currentLead.phone_number,
          CallerId: selectedPhoneNumber.phone_number,
          LeadId: currentLead.id,
        },
      });
      callRef.current = call;

      call.on("accept", () => setCallState("in-call"));
      call.on("disconnect", () => setCallState((s) => (s === "connecting" ? "idle" : "wrapup")));
      call.on("cancel", () => setCallState("idle"));
      call.on("error", (err: { message?: string }) => {
        setCallError(err?.message ?? "Der opstod en fejl under opkaldet.");
        setCallState("idle");
      });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : "Kunne ikke starte opkaldet.");
      setCallState("idle");
    }
  }

  function hangup() {
    callRef.current?.disconnect();
  }

  function toggleMute() {
    const next = !isMuted;
    callRef.current?.mute(next);
    setIsMuted(next);
  }

  async function saveWrapup(skipDisposition = false) {
    if (!currentLead || !selectedListId) return;
    setSavingWrapup(true);

    const res = await fetch(`/api/customer/lead-lists/${selectedListId}/leads/${currentLead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "called",
        disposition: skipDisposition ? null : disposition || null,
        notes: notes.trim() || null,
      }),
    });

    setSavingWrapup(false);
    if (!res.ok) return;

    const { lead: updated } = await res.json();
    setLeads((prev) => (prev ? prev.map((l) => (l.id === updated.id ? updated : l)) : prev));
    setDisposition("");
    setNotes("");
    setCallState("idle");
    advanceToNextPending();
  }

  function advanceToNextPending() {
    if (!leads) return;
    const next = leads.findIndex((l, i) => i > currentIndex && l.status === "pending");
    if (next !== -1) {
      setCurrentIndex(next);
      return;
    }
    const anyPending = leads.findIndex((l) => l.status === "pending");
    // No pending lead left at all — park the index past the end so
    // `currentLead` resolves to null and the "all done" state renders,
    // instead of silently re-showing the last (already-called) lead.
    setCurrentIndex(anyPending === -1 ? leads.length : anyPending);
  }

  function skipLead() {
    if (!leads) return;
    const next = leads.findIndex((l, i) => i > currentIndex && l.status === "pending");
    if (next !== -1) setCurrentIndex(next);
  }

  if (phoneNumbers.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dialer</h1>
          <p className="mt-1 text-sm text-slate-500">Ring selv ud til en leadliste, direkte fra browseren.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Køb et telefonnummer under &quot;Inbound&quot; først &mdash; dialer-opkald skal ringes fra et af jeres egne numre.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dialer</h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload en leadliste og ring selv ud til den, ét opkald ad gangen, direkte fra browseren.
          </p>
        </div>
        {!showUploadForm ? (
          <button
            type="button"
            onClick={() => setShowUploadForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Ny leadliste
          </button>
        ) : null}
      </div>

      {showUploadForm ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="list-name" className="mb-1 block text-sm font-medium text-slate-700">
              Listenavn
            </label>
            <input
              id="list-name"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="Fx Kolde leads – uge 34"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="list-leads" className="block text-sm font-medium text-slate-700">
                Leads (ét pr. linje, maks. 500)
              </label>
              <label className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700">
                Upload CSV/TXT-fil
                <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            <textarea
              id="list-leads"
              rows={8}
              value={uploadRaw}
              onChange={(e) => setUploadRaw(e.target.value)}
              placeholder={"+4512345678\n+4587654321, Jens Jensen\n+4511223344, Mette Hansen, Hansen ApS"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {uploadError ? <p className="text-sm text-red-600">{uploadError}</p> : null}

          <div className="flex gap-3">
            {lists.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowUploadForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuller
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {uploading ? "Opretter…" : "Opret liste →"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <h2 className="text-lg font-semibold text-slate-900">Jeres leadlister</h2>
          {lists.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Ingen leadlister endnu.
            </div>
          ) : (
            <ul className="space-y-2">
              {lists.map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    onClick={() => void selectList(list.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                      selectedListId === list.id
                        ? "border-brand-500 bg-brand-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-medium text-slate-800">{list.name}</p>
                    <p className="text-xs text-slate-500">{list.leads?.[0]?.count ?? 0} leads</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2">
          {!selectedListId ? (
            <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Vælg en leadliste for at starte dialer-opkald.
            </div>
          ) : loadingList || !leads ? (
            <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Indlæser…
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">
                  {calledCount} af {leads.length} ringet
                </p>
                <div className="w-56">
                  <label htmlFor="dialer-from" className="sr-only">
                    Ring fra
                  </label>
                  <select
                    id="dialer-from"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    disabled={callState !== "idle"}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  >
                    {phoneNumbers.map((p) => (
                      <option key={p.id} value={p.id}>
                        Ring fra: {phoneNumberLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!currentLead ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                  Alle leads på listen er ringet igennem.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 p-6">
                  <p className="text-lg font-semibold text-slate-900">
                    {currentLead.contact_name || "Ukendt navn"}
                  </p>
                  {currentLead.company ? <p className="text-sm text-slate-500">{currentLead.company}</p> : null}
                  <p className="mt-1 font-mono text-sm text-slate-700">{currentLead.phone_number}</p>
                  {currentLead.status === "called" ? (
                    <p className="mt-2 text-xs text-emerald-600">
                      Allerede ringet {currentLead.disposition ? `— ${currentLead.disposition}` : ""}
                    </p>
                  ) : null}

                  {callError ? <p className="mt-3 text-sm text-red-600">{callError}</p> : null}

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {callState === "idle" ? (
                      <>
                        <button
                          type="button"
                          onClick={startCall}
                          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
                        >
                          📞 Ring op
                        </button>
                        <button
                          type="button"
                          onClick={skipLead}
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Spring over
                        </button>
                      </>
                    ) : null}

                    {callState === "connecting" ? (
                      <span className="text-sm text-slate-500">Forbinder…</span>
                    ) : null}

                    {callState === "in-call" ? (
                      <>
                        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                          I samtale — {formatSeconds(callSeconds)}
                        </span>
                        <button
                          type="button"
                          onClick={toggleMute}
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {isMuted ? "Slå lyd til" : "Mute"}
                        </button>
                        <button
                          type="button"
                          onClick={hangup}
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                        >
                          Læg på
                        </button>
                      </>
                    ) : null}
                  </div>

                  {callState === "wrapup" ? (
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                      <p className="text-sm font-medium text-slate-700">Opkald afsluttet — hvad var udfaldet?</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <select
                          value={disposition}
                          onChange={(e) => setDisposition(e.target.value as LeadDisposition | "")}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">Vælg udfald…</option>
                          {DISPOSITIONS.map((d) => (
                            <option key={d.value} value={d.value}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Noter (valgfrit)"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => void saveWrapup(false)}
                          disabled={savingWrapup}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        >
                          {savingWrapup ? "Gemmer…" : "Gem og ring til næste →"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
