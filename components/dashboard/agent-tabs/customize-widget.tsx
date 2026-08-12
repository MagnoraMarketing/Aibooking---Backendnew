"use client";

import { useState } from "react";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { ToggleSwitch } from "../toggle-switch";

const THEMES = [
  { name: "Ocean Blue", description: "Rolig og professionel", primary: "#2563eb", secondary: "#1e3a8a" },
  { name: "Forest Green", description: "Naturlig og afbalanceret", primary: "#16a34a", secondary: "#14532d" },
  { name: "Sunset Orange", description: "Varm og energisk", primary: "#ea580c", secondary: "#7c2d12" },
  { name: "Summer Yellow", description: "Lys og glad", primary: "#eab308", secondary: "#713f12" },
  { name: "Royal Purple", description: "Kreativ og luksuriøs", primary: "#9333ea", secondary: "#581c87" },
] as const;

const POSITIONS = [
  { value: "bottom-left", label: "Nederst venstre" },
  { value: "bottom-right", label: "Nederst højre" },
  { value: "top-left", label: "Øverst venstre" },
  { value: "top-right", label: "Øverst højre" },
] as const;

export function CustomizeWidgetTab({ widget, savePatch }: { widget: WidgetWithExtras; savePatch: SavePatch }) {
  const [businessName, setBusinessName] = useState(widget.business_name ?? "");
  const [tagline, setTagline] = useState(widget.extra.tagline ?? "");
  const [logoUrl, setLogoUrl] = useState(widget.logo_url ?? "");
  const [primaryColor, setPrimaryColor] = useState(widget.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(widget.secondary_color);
  const [position, setPosition] = useState(widget.position);
  const [widgetSize, setWidgetSize] = useState(widget.widget_size);
  const [showBranding, setShowBranding] = useState(widget.show_branding);
  const [extra, setExtra] = useState(widget.extra);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  function setExtraFlag(key: keyof typeof extra, value: boolean) {
    setExtra((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const ok = await savePatch({
      businessName,
      logoUrl: logoUrl || null,
      primaryColor,
      secondaryColor,
      position,
      widgetSize,
      showBranding,
      extra: { ...extra, tagline: tagline || null },
    });
    setSaving(false);
    setStatus(ok ? "saved" : "error");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="bot-name" className="mb-1 block text-sm font-medium text-slate-700">
            Bottens navn
          </label>
          <input
            id="bot-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Fx AIbooking Assistent"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="tagline" className="mb-1 block text-sm font-medium text-slate-700">
            Tagline
          </label>
          <input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Fx Din digitale receptionist"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="logo-url" className="mb-1 block text-sm font-medium text-slate-700">
            Logo-URL
          </label>
          <input
            id="logo-url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Vælg tema</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEMES.map((theme) => {
              const isSelected = primaryColor === theme.primary && secondaryColor === theme.secondary;
              return (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => {
                    setPrimaryColor(theme.primary);
                    setSecondaryColor(theme.secondary);
                  }}
                  className={`rounded-xl border p-4 text-left transition ${
                    isSelected ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                  }`}
                  style={{ background: `linear-gradient(135deg, ${theme.primary}22, ${theme.secondary}22)` }}
                >
                  <p className="text-sm font-semibold text-slate-800">{theme.name}</p>
                  <p className="text-xs text-slate-500">{theme.description}</p>
                  {isSelected ? <p className="mt-1 text-xs font-medium text-brand-600">✓ Valgt</p> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Primær
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-slate-300"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Sekundær
              <input
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-slate-300"
              />
            </label>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Widget-placering</p>
          <div className="grid grid-cols-2 gap-3 sm:w-64">
            {POSITIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPosition(p.value)}
                className={`rounded-lg border px-3 py-3 text-xs font-medium transition ${
                  position === p.value
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="widget-size" className="mb-1 block text-sm font-medium text-slate-700">
            Størrelse
          </label>
          <select
            id="widget-size"
            value={widgetSize}
            onChange={(e) => setWidgetSize(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 sm:w-64"
          >
            <option value="small">Lille</option>
            <option value="medium">Mellem</option>
            <option value="large">Stor</option>
          </select>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Indstillinger</h2>
        <ToggleSwitch
          label="Vis AIbooking.dk-branding"
          checked={showBranding}
          onChange={setShowBranding}
        />
        <ToggleSwitch
          label="Transskription"
          description="Gem tekst-transskription af samtaler."
          checked={extra.transcriptionEnabled ?? true}
          onChange={(v) => setExtraFlag("transcriptionEnabled", v)}
        />
        <ToggleSwitch
          label="Tekst-chat"
          description="Tillad kunder at skrive i stedet for at tale."
          checked={extra.chatEnabled ?? true}
          onChange={(v) => setExtraFlag("chatEnabled", v)}
        />
        <ToggleSwitch
          label="Autostart"
          description="Åbn widgetten automatisk når siden indlæses."
          checked={extra.autostart ?? false}
          onChange={(v) => setExtraFlag("autostart", v)}
        />
        <ToggleSwitch
          label="Mute ved minimering"
          checked={extra.muteOnMinimize ?? false}
          onChange={(v) => setExtraFlag("muteOnMinimize", v)}
        />
        <ToggleSwitch
          label="Mute ved faneskift"
          checked={extra.muteOnTabChange ?? false}
          onChange={(v) => setExtraFlag("muteOnTabChange", v)}
        />
        <ToggleSwitch
          label="Vis lead-formular"
          checked={extra.showLeadForm ?? false}
          onChange={(v) => setExtraFlag("showLeadForm", v)}
        />
        <ToggleSwitch
          label="Glødende ikon"
          checked={extra.isGlowing ?? false}
          onChange={(v) => setExtraFlag("isGlowing", v)}
        />
        <ToggleSwitch
          label="Transparent baggrund"
          checked={extra.isTransparent ?? false}
          onChange={(v) => setExtraFlag("isTransparent", v)}
        />
        <ToggleSwitch
          label="Mute agent"
          checked={extra.agentMute ?? false}
          onChange={(v) => setExtraFlag("agentMute", v)}
        />
      </div>

      <p className="text-xs text-slate-500">
        Farve, størrelse, placering og branding-visning slår igennem på den rigtige widget med det samme. De øvrige
        til/fra-valg gemmes til jeres profil, men styrer endnu ikke widgettens adfærd i denne udgave.
      </p>

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
