"use client";

import { useEffect, useState } from "react";
import { errorMessageOf, inputClass, secondaryButtonClass } from "./download";
import { formatDateTime } from "./labels";

interface Entry {
  id: string;
  phone_number: string;
  reason: string | null;
  created_at: string;
}

// The customer's do-not-call list. Numbers here are never rung — not from
// the dialer, not by an AI campaign — whichever list they turn up in.
export function DoNotCallPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/customer/do-not-call");
    if (res.ok) setEntries(((await res.json()) as { numbers: Entry[] }).numbers);
  }

  useEffect(() => {
    if (open && entries === null) void load();
  }, [open, entries]);

  async function add() {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/customer/do-not-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, reason: reason || null }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await errorMessageOf(res, "Kunne ikke tilføje nummeret."));
      return;
    }
    setPhone("");
    setReason("");
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Fjern nummeret fra spærrelisten? Det kan så ringes op igen.")) return;
    const res = await fetch(`/api/customer/do-not-call/${id}`, { method: "DELETE" });
    if (res.ok) setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold text-slate-900">Spærreliste (må ikke ringes op)</span>
        <span className="text-xs text-slate-500">{open ? "Skjul" : "Vis"}</span>
      </button>
      {open ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefonnummer" className={inputClass} />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Årsag (valgfri)" className={inputClass} />
            <button type="button" onClick={() => void add()} disabled={busy} className={secondaryButtonClass}>
              Tilføj
            </button>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {entries === null ? (
            <p className="text-sm text-slate-500">Indlæser…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500">Ingen numre på spærrelisten.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-slate-100 overflow-auto text-sm">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-mono text-slate-800">{entry.phone_number}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(entry.created_at)}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => void remove(entry.id)} className="text-xs font-medium text-red-600 hover:text-red-700">
                    Fjern
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
