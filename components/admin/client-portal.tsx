"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AdminStatCard } from "./stat-card";

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive" | "deleted";
  createdAt: string;
  creditPricePerMinute: number | null;
  currency: string;
  minutesRemaining: number;
  minutesUsed: number;
  activeAgents: number;
  totalAgents: number;
}

export interface AdminStats {
  totalClients: number;
  newClients30d: number;
  mrr: number;
  grossMargin: number;
  totalMinutesRemaining: number;
  totalAgents: number;
  currency: string;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("da-DK", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ClientPortal({ initialClients, stats }: { initialClients: ClientRow[]; stats: AdminStats }) {
  const [clients, setClients] = useState(initialClients);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [creditPromptFor, setCreditPromptFor] = useState<{ id: string; direction: "add" | "remove" } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter(
      (c) => c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query)
    );
  }, [clients, search]);

  async function handleCreateClient() {
    if (!newName.trim() || !newEmail.trim()) {
      setFormError("Udfyld navn og email.");
      return;
    }
    setCreating(true);
    setFormError(null);

    const res = await fetch("/api/admin/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), email: newEmail.trim() }),
    });

    setCreating(false);

    if (!res.ok) {
      setFormError("Kunne ikke oprette kunden. Prøv igen.");
      return;
    }

    setNewName("");
    setNewEmail("");
    setShowAddForm(false);
    window.location.reload();
  }

  async function handleToggleStatus(client: ClientRow) {
    setBusyId(client.id);
    const nextStatus = client.status === "active" ? "inactive" : "active";

    const res = await fetch(`/api/admin/customers/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    setBusyId(null);
    if (res.ok) {
      setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, status: nextStatus } : c)));
    }
  }

  async function handleConfirmCreditChange() {
    if (!creditPromptFor) return;
    const minutes = Number(creditAmount);
    if (!minutes || minutes <= 0) return;

    setBusyId(creditPromptFor.id);
    const signedMinutes = creditPromptFor.direction === "add" ? minutes : -minutes;

    const res = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: creditPromptFor.id,
        minutes: signedMinutes,
        description:
          creditPromptFor.direction === "add"
            ? `Manuel tilføjelse af ${minutes} minutter (admin)`
            : `Manuel fjernelse af ${minutes} minutter (admin)`,
      }),
    });

    setBusyId(null);

    if (res.ok) {
      const data = await res.json();
      const minutesRemaining = Math.round((data.balanceSeconds / 60) * 100) / 100;
      setClients((prev) =>
        prev.map((c) => (c.id === creditPromptFor.id ? { ...c, minutesRemaining } : c))
      );
    }

    setCreditPromptFor(null);
    setCreditAmount("");
  }

  async function handleDelete(client: ClientRow) {
    if (!window.confirm(`Slet ${client.name}? Dette deaktiverer kundens konto og widgets.`)) return;
    setBusyId(client.id);

    const res = await fetch(`/api/admin/customers/${client.id}`, { method: "DELETE" });

    setBusyId(null);
    if (res.ok) {
      setClients((prev) => prev.filter((c) => c.id !== client.id));
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Client Portal</h1>
        <p className="mt-1 text-sm text-slate-500">Overblik over kunder, omsætning og forbrug</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="Kunder i alt" value={String(stats.totalClients)} />
        <AdminStatCard label="Nye kunder (30 dage)" value={String(stats.newClients30d)} />
        <AdminStatCard label="Omsætning (MRR)" value={formatCurrency(stats.mrr, stats.currency)} />
        <AdminStatCard label="Estimeret overskud" value={formatCurrency(stats.grossMargin, stats.currency)} />
        <AdminStatCard label="Credits tilbage i alt" value={`${stats.totalMinutesRemaining.toFixed(0)} min`} />
        <AdminStatCard label="Agenter i alt" value={String(stats.totalAgents)} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Kunder</h2>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + Tilføj kunde
        </button>
      </div>

      {showAddForm ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="new-client-name" className="mb-1 block text-sm font-medium text-slate-700">
                Navn / virksomhed
              </label>
              <input
                id="new-client-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="new-client-email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="new-client-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          {formError ? <p className="mt-2 text-sm text-red-600">{formError}</p> : null}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={handleCreateClient}
              disabled={creating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? "Opretter…" : "Opret kunde"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annuller
            </button>
          </div>
        </div>
      ) : null}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Søg kunder på navn eller email…"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Ingen kunder fundet.
          </div>
        ) : (
          filtered.map((client) => (
            <div key={client.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                    {initials(client.name) || "?"}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{client.name}</p>
                    <p className="text-xs text-slate-500">{client.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {client.creditPricePerMinute !== null ? (
                    <span className="text-xs text-slate-500">
                      Overpris: {formatCurrency(client.creditPricePerMinute, client.currency)}/min
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      client.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {client.status === "active" ? "Aktiv" : "Inaktiv"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={client.status === "active"}
                    disabled={busyId === client.id}
                    onClick={() => handleToggleStatus(client)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      client.status === "active" ? "bg-emerald-500" : "bg-slate-300"
                    } disabled:opacity-60`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                        client.status === "active" ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Credits tilbage</p>
                  <p className="text-sm font-semibold text-slate-800">{client.minutesRemaining.toFixed(0)} min</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Minutter brugt</p>
                  <p className="text-sm font-semibold text-slate-800">{client.minutesUsed.toFixed(0)} min</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Aktive agenter</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {client.activeAgents} / {client.totalAgents}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Oprettet</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {new Date(client.createdAt).toLocaleDateString("da-DK")}
                  </p>
                </div>
              </div>

              {creditPromptFor?.id === client.id ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-600">
                    {creditPromptFor.direction === "add" ? "Tilføj" : "Fjern"} minutter:
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleConfirmCreditChange}
                    disabled={busyId === client.id}
                    className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Bekræft
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreditPromptFor(null);
                      setCreditAmount("");
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-white"
                  >
                    Annuller
                  </button>
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Link
                  href={`/admin/customers/${client.id}`}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-center text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  Se konto
                </Link>
                <Link
                  href={`/admin/customers/${client.id}`}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Administrer agenter
                </Link>
                <button
                  type="button"
                  onClick={() => setCreditPromptFor({ id: client.id, direction: "add" })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  Tilføj credits
                </button>
                <button
                  type="button"
                  onClick={() => setCreditPromptFor({ id: client.id, direction: "remove" })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                >
                  Fjern credits
                </button>
                <button
                  type="button"
                  disabled
                  title="Kommer snart — priser sættes i dag pr. pakke, ikke pr. kunde"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400"
                >
                  Opdater pris
                </button>
                <button
                  type="button"
                  disabled
                  title="Kommer snart"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400"
                >
                  Rettigheder
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(client)}
                  disabled={busyId === client.id}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  Slet
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
