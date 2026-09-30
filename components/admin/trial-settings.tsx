"use client";

import { useState } from "react";

interface TrialSettingsProps {
  initialMinutes: number;
  initialInternalNote: string;
}

// The free trial every new customer starts with. The minutes are what the
// customer sees; the note is the admin's own and is never shown to them.
export function TrialSettings({ initialMinutes, initialInternalNote }: TrialSettingsProps) {
  const [minutes, setMinutes] = useState(String(initialMinutes));
  const [note, setNote] = useState(initialInternalNote);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSave() {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 0 || value > 600) {
      setMessage({ type: "error", text: "Antal minutter skal være et helt tal mellem 0 og 600." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings/trial", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: value, internalNote: note.trim() }),
      });
      if (!res.ok) throw new Error("Kunne ikke gemme prøveperioden");
      setMessage({ type: "success", text: "Prøveperioden er gemt. Den gælder for nye kunder fra nu af." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Noget gik galt." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Gratis prøveperiode</h2>
        <p className="mt-1 text-sm text-slate-600">
          Alle nye kunder får disse minutter gratis i de 7 dages prøveperiode. Platformen betaler for dem. Kunden ser kun,
          hvor mange minutter de har tilbage. Når de køber en pakke, bruger de pakkens minutter.
        </p>
      </div>

      <label className="block text-sm font-medium text-slate-700">
        Gratis minutter pr. ny kunde
        <input
          type="number"
          min={0}
          max={600}
          step={1}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="mt-1 block w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          0 betyder ingen gratis minutter. Ændringen gælder kun kunder, der oprettes herefter.
        </span>
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Intern note <span className="font-normal text-slate-500">(kun synlig for admin)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Fx hvad prøveminutterne koster platformen, eller hvorfor antallet er sat sådan."
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
        />
      </label>

      {message ? (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "Gemmer…" : "Gem"}
      </button>
    </div>
  );
}
