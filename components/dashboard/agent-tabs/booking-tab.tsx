"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookingSetupRequestStatus } from "@/types/database";
import type { WidgetWithExtras } from "../agent-configurator";

interface BookingTabProps {
  widget: WidgetWithExtras;
}

interface SetupRequest {
  id: string;
  status: BookingSetupRequestStatus;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// The steps our team works through once booking is ordered. Shown to the
// customer as a progress list so "vi er i gang" is something they can see
// rather than something they have to ask about.
const SETUP_STEPS = [
  "Bestilling modtaget",
  "Kalender oprettet",
  "Jeres kalender forbundet",
  "Ydelser og tider sat op",
  "Stemmeagent forbundet",
  "Booking testet",
] as const;

// How far through SETUP_STEPS each status is. 'completed' lights all of them.
const STEPS_DONE: Record<BookingSetupRequestStatus, number> = {
  pending: 1,
  in_progress: 3,
  completed: SETUP_STEPS.length,
  cancelled: 0,
};

const STATUS_LABEL: Record<BookingSetupRequestStatus, string> = {
  pending: "Bestilt — vi går i gang",
  in_progress: "Under opsætning",
  completed: "Aktiv",
  cancelled: "Annulleret",
};

export function BookingTab({ widget }: BookingTabProps) {
  const [request, setRequest] = useState<SetupRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customer/widgets/${widget.id}/booking-setup`);
    if (res.ok) {
      const data = await res.json();
      setRequest(data.request ?? null);
    }
    setLoading(false);
  }, [widget.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleOrder() {
    setOrdering(true);
    setError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}/booking-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notes.trim() ? { notes: notes.trim() } : {}),
    });
    setOrdering(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Bestillingen kunne ikke sendes. Prøv igen.");
      return;
    }
    const data = await res.json();
    setRequest(data.request ?? null);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Henter…</p>;
  }

  // booking_enabled is the flag the agent itself reads, so it — not the
  // request's status — is what decides whether we tell the customer their
  // agent can take bookings right now.
  const live = widget.booking_enabled;
  const stepsDone = live ? SETUP_STEPS.length : request ? STEPS_DONE[request.status] : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Booking</h2>
            <p className="mt-1 text-sm text-slate-600">
              Lader agenten finde ledige tider og booke, flytte og aflyse aftaler i jeres kalender.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              live
                ? "bg-emerald-50 text-emerald-700"
                : request && request.status !== "cancelled"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {live ? "Aktiv" : request ? STATUS_LABEL[request.status] : "Ikke tilvalgt"}
          </span>
        </div>

        {live ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Agenten kan booke tider. Prøv den under <strong>Test Agent</strong> — bed om en tid og se
            at den kun tilbyder tidspunkter der faktisk er ledige.
          </p>
        ) : null}

        {request && !live && request.status !== "cancelled" ? (
          <ol className="space-y-2">
            {SETUP_STEPS.map((step, i) => {
              const done = i < stepsDone;
              return (
                <li key={step} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={done ? "text-slate-800" : "text-slate-400"}>{step}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {request?.notes ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            {request.notes}
          </p>
        ) : null}

        {!request && !live ? (
          <div className="space-y-3">
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Booking er et tilvalg. I bestiller det her, og vi sætter det hele op for jer — kalender,
              jeres ydelser, åbningstider og test. I skal ikke konfigurere noget selv.
            </p>
            <div>
              <label htmlFor="booking-notes" className="mb-1 block text-sm font-medium text-slate-700">
                Noget vi skal vide? (valgfrit)
              </label>
              <textarea
                id="booking-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Fx hvilke ydelser I tilbyder, hvor lang tid de tager, og jeres åbningstider."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="button"
              onClick={handleOrder}
              disabled={ordering}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {ordering ? "Sender…" : "Tilføj booking"}
            </button>
          </div>
        ) : null}

        {request?.status === "cancelled" && !live ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Opsætningen blev annulleret. I kan bestille igen.</p>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="button"
              onClick={handleOrder}
              disabled={ordering}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {ordering ? "Sender…" : "Bestil igen"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
