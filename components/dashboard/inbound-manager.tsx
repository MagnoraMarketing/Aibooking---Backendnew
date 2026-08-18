"use client";

import { useState } from "react";
import type { Widget } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import { CallForwardingInstructions } from "./call-forwarding-instructions";

interface InboundManagerProps {
  widgets: Widget[];
  initialPhoneNumbers: PhoneNumberRow[];
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  monthlyPriceDkk: number;
}

type Mode = "buy" | "byo";

export function InboundManager({ widgets, initialPhoneNumbers }: InboundManagerProps) {
  const [phoneNumbers, setPhoneNumbers] = useState(initialPhoneNumbers);
  const [showForm, setShowForm] = useState(initialPhoneNumbers.length === 0);
  const [mode, setMode] = useState<Mode>("buy");
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [label, setLabel] = useState("");

  // Buy-a-number state
  const [searching, setSearching] = useState(false);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[] | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  // BYO-Twilio state
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [importing, setImporting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function widgetName(id: string): string {
    return widgets.find((w) => w.id === id)?.name ?? "Ukendt agent";
  }

  function resetBuyState() {
    setAvailableNumbers(null);
    setSelectedNumber(null);
  }

  async function handleSearch() {
    setSearching(true);
    setError(null);
    resetBuyState();

    const res = await fetch("/api/customer/phone-numbers/search");
    setSearching(false);

    if (!res.ok) {
      setError("Kunne ikke hente ledige numre. Prøv igen.");
      return;
    }

    const { numbers } = await res.json();
    setAvailableNumbers(numbers);
  }

  async function handlePurchase() {
    if (!widgetId || !selectedNumber) {
      setError("Vælg agent og et nummer.");
      return;
    }
    setPurchasing(true);
    setError(null);

    const res = await fetch("/api/customer/phone-numbers/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, phoneNumber: selectedNumber, label: label.trim() || undefined }),
    });

    setPurchasing(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke købe nummeret.");
      return;
    }

    const { phoneNumber } = await res.json();
    setPhoneNumbers((prev) => [phoneNumber, ...prev]);
    setLabel("");
    resetBuyState();
    setShowForm(false);
  }

  async function handleImport() {
    if (!widgetId || !twilioAccountSid.trim() || !twilioAuthToken.trim() || !twilioPhoneNumber.trim()) {
      setError("Udfyld agent og alle Twilio-felter.");
      return;
    }
    setImporting(true);
    setError(null);

    const res = await fetch("/api/customer/phone-numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widgetId,
        twilioAccountSid: twilioAccountSid.trim(),
        twilioAuthToken: twilioAuthToken.trim(),
        twilioPhoneNumber: twilioPhoneNumber.trim(),
        label: label.trim() || undefined,
      }),
    });

    setImporting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke importere nummeret.");
      return;
    }

    const { phoneNumber } = await res.json();
    setPhoneNumbers((prev) => [phoneNumber, ...prev]);
    setTwilioAccountSid("");
    setTwilioAuthToken("");
    setTwilioPhoneNumber("");
    setLabel("");
    setShowForm(false);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inbound</h1>
          <p className="mt-1 text-sm text-slate-500">
            Få et telefonnummer, og viderestil jeres eksisterende nummer til det, så AI-agenten svarer kunderne.
          </p>
        </div>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Nyt nummer
          </button>
        ) : null}
      </div>

      {widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Opret en agent under &quot;Agent&quot; f&oslash;rst &mdash; et telefonnummer skal knyttes til en agent.
        </div>
      ) : showForm ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("buy");
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                mode === "buy" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Køb nummer gennem os
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("byo");
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                mode === "byo" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Brug eget Twilio-nummer
            </button>
          </div>

          <div>
            <label htmlFor="inbound-widget" className="mb-1 block text-sm font-medium text-slate-700">
              Agent
            </label>
            <select
              id="inbound-widget"
              value={widgetId}
              onChange={(e) => setWidgetId(e.target.value)}
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
            <label htmlFor="phone-label" className="mb-1 block text-sm font-medium text-slate-700">
              Label (valgfrit)
            </label>
            <input
              id="phone-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Fx Hovednummer"
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {mode === "buy" ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Vi køber et dansk nummer til jer og forbinder det med agenten med det samme. I betaler den månedlige
                pris for nummeret oveni jeres abonnement.
              </p>

              {availableNumbers === null ? (
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {searching ? "Søger…" : "Søg ledige numre →"}
                </button>
              ) : availableNumbers.length === 0 ? (
                <p className="text-sm text-slate-500">Ingen ledige numre lige nu. Prøv igen om lidt.</p>
              ) : (
                <ul className="space-y-2">
                  {availableNumbers.map((n) => (
                    <li key={n.phoneNumber}>
                      <label
                        className={`flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 text-sm transition ${
                          selectedNumber === n.phoneNumber
                            ? "border-brand-500 ring-1 ring-brand-500"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="available-number"
                            checked={selectedNumber === n.phoneNumber}
                            onChange={() => setSelectedNumber(n.phoneNumber)}
                          />
                          <span>
                            <span className="font-medium text-slate-800">{n.phoneNumber}</span>
                            {n.locality ? <span className="ml-2 text-xs text-slate-500">{n.locality}</span> : null}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-slate-500">{n.monthlyPriceDkk} DKK/md</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                I bringer jeres eget Twilio-nummer med. Find Account SID og Auth Token i jeres Twilio-konsol.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="twilio-sid" className="mb-1 block text-sm font-medium text-slate-700">
                    Twilio Account SID
                  </label>
                  <input
                    id="twilio-sid"
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label htmlFor="twilio-token" className="mb-1 block text-sm font-medium text-slate-700">
                    Twilio Auth Token
                  </label>
                  <input
                    id="twilio-token"
                    type="password"
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="twilio-number" className="mb-1 block text-sm font-medium text-slate-700">
                  Telefonnummer
                </label>
                <input
                  id="twilio-number"
                  value={twilioPhoneNumber}
                  onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                  placeholder="+4512345678"
                  className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            {phoneNumbers.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuller
              </button>
            ) : null}
            {mode === "buy" ? (
              <button
                type="button"
                onClick={handlePurchase}
                disabled={purchasing || !selectedNumber}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {purchasing ? "Køber…" : "Køb nummer →"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {importing ? "Importerer…" : "Importér nummer →"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Jeres numre</h2>
        {phoneNumbers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Ingen telefonnumre endnu.
          </div>
        ) : (
          <div className="space-y-6">
            {phoneNumbers.map((phoneNumber) => (
              <div key={phoneNumber.id} className="space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {phoneNumber.label || phoneNumber.phone_number}
                    </p>
                    <p className="text-xs text-slate-500">
                      {phoneNumber.phone_number} · {widgetName(phoneNumber.widget_id)}
                      {phoneNumber.source === "platform_twilio" && phoneNumber.monthly_price_dkk
                        ? ` · ${phoneNumber.monthly_price_dkk} DKK/md`
                        : null}
                    </p>
                  </div>
                </div>
                <CallForwardingInstructions phoneNumber={phoneNumber.phone_number} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
