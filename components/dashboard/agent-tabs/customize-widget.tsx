"use client";

import { useState } from "react";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { ToggleSwitch } from "../toggle-switch";
import { useTranslation } from "@/components/i18n/language-provider";

function themesFor(t: (key: string) => string) {
  return [
    { name: "Ocean Blue", description: t("agent.customize.themeOceanDescription"), primary: "#2563eb", secondary: "#1e3a8a" },
    { name: "Forest Green", description: t("agent.customize.themeForestDescription"), primary: "#16a34a", secondary: "#14532d" },
    { name: "Sunset Orange", description: t("agent.customize.themeSunsetDescription"), primary: "#ea580c", secondary: "#7c2d12" },
    { name: "Summer Yellow", description: t("agent.customize.themeSummerDescription"), primary: "#eab308", secondary: "#713f12" },
    { name: "Royal Purple", description: t("agent.customize.themeRoyalDescription"), primary: "#9333ea", secondary: "#581c87" },
  ] as const;
}

function positionsFor(t: (key: string) => string) {
  return [
    { value: "bottom-left", label: t("agent.customize.positionBottomLeft") },
    { value: "bottom-right", label: t("agent.customize.positionBottomRight") },
    { value: "top-left", label: t("agent.customize.positionTopLeft") },
    { value: "top-right", label: t("agent.customize.positionTopRight") },
  ] as const;
}

export function CustomizeWidgetTab({ widget, savePatch }: { widget: WidgetWithExtras; savePatch: SavePatch }) {
  const { t } = useTranslation();
  const THEMES = themesFor(t);
  const POSITIONS = positionsFor(t);
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
            {t("agent.customize.botNameLabel")}
          </label>
          <input
            id="bot-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder={t("agent.customize.botNamePlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="tagline" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.customize.taglineLabel")}
          </label>
          <input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder={t("agent.customize.taglinePlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="logo-url" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.customize.logoUrlLabel")}
          </label>
          <input
            id="logo-url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder={t("agent.customize.logoUrlPlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.customize.chooseThemeLabel")}</p>
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
                  {isSelected ? (
                    <p className="mt-1 text-xs font-medium text-brand-600">{t("agent.customize.selectedBadge")}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              {t("agent.customize.primaryColorLabel")}
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-slate-300"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              {t("agent.customize.secondaryColorLabel")}
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
          <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.customize.widgetPlacementLabel")}</p>
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
