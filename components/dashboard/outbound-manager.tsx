"use client";

import { useMemo, useState } from "react";
import type { Widget } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import type { CampaignRow } from "@/app/dashboard/outbound/page";

interface OutboundManagerProps {
  widgets: Widget[];
  phoneNumbers: PhoneNumberRow[];
  initialCampaigns: CampaignRow[];
}

// One line per contact: "+4512345678" or "+4512345678, Navn"
function parseContacts(raw: string): { phoneNumber: string; name?: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phoneNumber, ...rest] = line.split(",").map((part) => part.trim());
      const name = rest.filter(Boolean).join(", ");
      return { phoneNumber: phoneNumber ?? "", name: name || undefined };
    });
}

export function OutboundManager({ widgets, phoneNumbers, initialCampaigns }: OutboundManagerProps) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [showForm, setShowForm] = useState(initialCampaigns.length === 0);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [name, setName] = useState("");
  const [contactsRaw, setContactsRaw] = useState("");
  const [creating, setCreating] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const numbersForWidget = useMemo(
    () => phoneNumbers.filter((p) => p.widget_id === widgetId),
    [phoneNumbers, widgetId]
  );

  function widgetName(id: string): string {
    return widgets.find((w) => w.id === id)?.name ?? "Ukendt agent";
  }

  function phoneNumberLabel(id: string): string {
    const phoneNumber = phoneNumbers.find((p) => p.id === id);
    return phoneNumber ? phoneNumber.label || phoneNumber.phone_number : "Ukendt nummer";
  }

  async function handleCreate() {
    const contacts = parseContacts(contactsRaw);
    if (!name.trim()) {
      setError("Angiv et navn til kampagnen.");
      return;
    }
    if (!phoneNumberId) {
      setError("Vælg hvilket nummer der skal ringes fra.");
      return;
    }
    if (contacts.length === 0) {
      setError("Indsæt mindst ét telefonnummer.");
      return;
    }
    if (contacts.length > 100) {
      setError("Maks. 100 numre pr. kampagne.");
      return;
    }

    setCreating(true);
    setError(null);

    const res = await fetch("/api/customer/outbound-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, phoneNumberId, name: name.trim(), contacts }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke oprette kampagnen.");
      return;
    }

    const { campaign } = await res.json();
    setCampaigns((prev) => [{ ...campaign, outbound_campaign_contacts: [{ count: contacts.length }] }, ...prev]);
    setName("");
    setContactsRaw("");
    setShowForm(false);
  }

  async function handleLaunch(campaignId: string) {
    setLaunchingId(campaignId);
    setError(null);

    const res = await fetch(`/api/customer/outbound-campaigns/${campaignId}/launch`, { method: "POST" });

    setLaunchingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke starte kampagnen.");
      return;
    }

    setCampaigns((prev) =>
      prev.map((c) => (c.id === campaignId ? { ...c, status: "launched", launched_at: new Date().toISOString() } : c))
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Outbound</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ring automatisk ud til en liste af numre med jeres AI-agent.
          </p>
        </div>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Ny kampagne
          </button>
        ) : null}
      </div>

      {phoneNumbers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Tilføj et telefonnummer under &quot;Inbound&quot; først &mdash; outbound-opkald skal ringes fra et nummer.
        </div>
      ) : showForm ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="campaign-name" className="mb-1 block text-sm font-medium text-slate-700">
              Kampagnenavn
            </label>
            <input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fx Opfølgning på leads – uge 34"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="campaign-widget" className="mb-1 block text-sm font-medium text-slate-700">
                Agent
              </label>
              <select
                id="campaign-widget"
                value={widgetId}
                onChange={(e) => {
                  setWidgetId(e.target.value);
                  setPhoneNumberId("");
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {widgets.map((widget) => (
                  <option key={widget.id} value={widget.id}>
                    {widget.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="campaign-phone" className="mb-1 block text-sm font-medium text-slate-700">
                Ring fra
              </label>
              <select
                id="campaign-phone"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Vælg nummer…</option>
                {numbersForWidget.map((phoneNumber) => (
                  <option key={phoneNumber.id} value={phoneNumber.id}>
                    {phoneNumber.label || phoneNumber.phone_number}
                  </option>
                ))}
              </select>
              {numbersForWidget.length === 0 ? (
                <p className="mt-1 text-xs text-amber-600">Denne agent har intet telefonnummer endnu.</p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor="campaign-contacts" className="mb-1 block text-sm font-medium text-slate-700">
              Numre der skal ringes op (ét pr. linje, maks. 100)
            </label>
            <textarea
              id="campaign-contacts"
              rows={8}
              value={contactsRaw}
              onChange={(e) => setContactsRaw(e.target.value)}
              placeholder={"+4512345678\n+4587654321, Jens Jensen"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            {campaigns.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuller
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? "Opretter…" : "Opret kampagne →"}
            </button>
          </div>
        </div>
      ) : null}

      {error && !showForm ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Jeres kampagner</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Ingen kampagner endnu.
          </div>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((campaign) => (
              <li
                key={campaign.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{campaign.name}</p>
                  <p className="text-xs text-slate-500">
                    {widgetName(campaign.widget_id)} · {phoneNumberLabel(campaign.phone_number_id)} ·{" "}
                    {campaign.outbound_campaign_contacts?.[0]?.count ?? 0} numre
                  </p>
                </div>
                {campaign.status === "draft" ? (
                  <button
                    type="button"
                    onClick={() => handleLaunch(campaign.id)}
                    disabled={launchingId === campaign.id}
                    className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {launchingId === campaign.id ? "Starter…" : "Start kampagne"}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                    Startet
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
