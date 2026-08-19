"use client";

import { useState } from "react";

interface VapiVoiceTemplatesSettingsProps {
  initialMaleAssistantId: string | null;
  initialFemaleAssistantId: string | null;
}

// Lets a master admin point "Mand"/"Dame" (the only voice choice customers
// ever see for a Widget Voice agent) at two hand-configured Vapi assistants
// — every customer widget on the Vapi model clones its `voice` config from
// whichever of these two its own agent is set to (see
// resolveVoiceConfig in lib/vapi/assistants.ts). The ids themselves are
// never shown in the customer-facing Settings tab.
export function VapiVoiceTemplatesSettings({
  initialMaleAssistantId,
  initialFemaleAssistantId,
}: VapiVoiceTemplatesSettingsProps) {
  const [maleAssistantId, setMaleAssistantId] = useState(initialMaleAssistantId ?? "");
  const [femaleAssistantId, setFemaleAssistantId] = useState(initialFemaleAssistantId ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const res = await fetch("/api/admin/settings/vapi-voice-templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maleAssistantId: maleAssistantId.trim() || null,
        femaleAssistantId: femaleAssistantId.trim() || null,
      }),
    });
    setSaving(false);
    setStatus(res.ok ? "saved" : "error");
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Vapi stemme-agenter</h2>
        <p className="mt-1 text-sm text-slate-500">
          Peg &quot;Mand&quot; og &quot;Dame&quot; på jeres to hand-konfigurerede Vapi-agenter. Kunder vælger kun
          mellem Mand/Dame i deres Widget Voice-agent — de ser aldrig disse ID&apos;er.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="vapi-male-id" className="mb-1 block text-sm font-medium text-slate-700">
            Mand — Vapi Assistant ID
          </label>
          <input
            id="vapi-male-id"
            type="text"
            value={maleAssistantId}
            onChange={(e) => setMaleAssistantId(e.target.value)}
            placeholder="fx 8f1c2e3a-..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label htmlFor="vapi-female-id" className="mb-1 block text-sm font-medium text-slate-700">
            Dame — Vapi Assistant ID
          </label>
          <input
            id="vapi-female-id"
            type="text"
            value={femaleAssistantId}
            onChange={(e) => setFemaleAssistantId(e.target.value)}
            placeholder="fx 8f1c2e3a-..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Gemmer…" : "Gem"}
        </button>
        {status === "saved" ? <span className="text-sm text-emerald-600">Gemt.</span> : null}
        {status === "error" ? <span className="text-sm text-red-600">Kunne ikke gemme.</span> : null}
      </div>
    </div>
  );
}
