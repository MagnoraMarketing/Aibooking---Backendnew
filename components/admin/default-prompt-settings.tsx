"use client";

import { useState } from "react";

interface DefaultPromptSettingsProps {
  initialPrompt: string;
}

export function DefaultPromptSettings({ initialPrompt }: DefaultPromptSettingsProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSave() {
    if (!prompt.trim()) {
      setMessage({ type: "error", text: "Prompt kan ikke være tom." });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/settings/default-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!res.ok) {
        throw new Error("Kunne ikke gemme prompt");
      }

      setMessage({ type: "success", text: "Standard prompt gemt." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Noget gik galt.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Standard System Prompt</label>
        <p className="text-sm text-gray-600 mb-3">
          Denne prompt bruges som standard når nye agenter oprettes. Kunder kan tilpasse den for hver agent.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          placeholder="Skriv standard prompt her..."
        />
        <p className="text-xs text-gray-500 mt-2">{prompt.length} / 8000 tegn</p>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Gemmer..." : "Gem"}
      </button>
    </div>
  );
}
