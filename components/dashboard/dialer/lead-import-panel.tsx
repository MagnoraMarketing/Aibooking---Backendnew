"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { analyzeLeadCsv, toCsv, LEAD_CSV_TEMPLATE, type ImportAnalysis, type ImportRow } from "@/lib/outbound/csv";
import { PHONE_COUNTRIES, type PhoneCountry } from "@/lib/outbound/phone";
import {
  downloadTextFile,
  errorMessageOf,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./download";

interface LeadImportPanelProps {
  lists: { id: string; name: string }[];
  // Import into this list instead of offering a choice (the "+ Tilføj leads"
  // button on an open list).
  fixedListId?: string | null;
  onImported: (result: { listId: string; inserted: number; message: string }) => void;
  onCancel?: () => void;
}

type DuplicateMode = "skip" | "import" | "update";

interface ServerDuplicates {
  inList: Set<string>;
  inTenant: Set<string>;
  suppressed: Set<string>;
}

const CHUNK_SIZE = 250;
const PREVIEW_ROWS = 100;

const COUNTRY_LABELS: Record<PhoneCountry, string> = {
  DK: "Danmark (+45)",
  NO: "Norge (+47)",
  SE: "Sverige (+46)",
  DE: "Tyskland (+49)",
  GB: "Storbritannien (+44)",
  US: "USA (+1)",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  valid: { label: "Gyldig", className: "text-emerald-700" },
  invalid: { label: "Ugyldig", className: "text-red-600" },
  missing_phone: { label: "Mangler nummer", className: "text-red-600" },
  duplicate: { label: "Dublet i filen", className: "text-amber-600" },
  in_list: { label: "Findes allerede på listen", className: "text-amber-600" },
  in_tenant: { label: "Findes på en anden liste", className: "text-amber-600" },
  suppressed: { label: "På spærrelisten", className: "text-red-600" },
};

// CSV upload (or pasted lines) → preview → import. Also the "add lead
// manually" form, which is just an import of one row.
export function LeadImportPanel({ lists, fixedListId, onImported, onCancel }: LeadImportPanelProps) {
  const [mode, setMode] = useState<"csv" | "manual">("csv");
  const [target, setTarget] = useState<string>(fixedListId ?? (lists.length === 0 ? "new" : lists[0]!.id));
  const [newListName, setNewListName] = useState("");
  const [country, setCountry] = useState<PhoneCountry>("DK");
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");
  const [serverDuplicates, setServerDuplicates] = useState<ServerDuplicates | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [manual, setManual] = useState({ phone: "", name: "", company: "", email: "", notes: "", custom: "" });

  const analysis: ImportAnalysis | null = useMemo(
    () => (raw.trim() ? analyzeLeadCsv(raw, country) : null),
    [raw, country]
  );

  const listId = fixedListId ?? (target === "new" ? null : target);

  function rowStatus(row: ImportRow): string {
    if (row.status !== "valid" || !row.phone || !serverDuplicates) return row.status;
    if (serverDuplicates.suppressed.has(row.phone)) return "suppressed";
    if (serverDuplicates.inList.has(row.phone)) return "in_list";
    if (serverDuplicates.inTenant.has(row.phone)) return "in_tenant";
    return "valid";
  }

  const counts = useMemo(() => {
    if (!analysis) return null;
    const statuses = analysis.rows.map(rowStatus);
    return {
      ...analysis.summary,
      existing: statuses.filter((s) => s === "in_list" || s === "in_tenant").length,
      suppressed: statuses.filter((s) => s === "suppressed").length,
      ambiguous: analysis.rows.filter((r) => r.ambiguous && r.status === "valid").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, serverDuplicates]);

  // What counts as "already have it" depends on the target list and on how
  // numbers were normalized, so both re-run the check.
  useEffect(() => {
    if (raw.trim()) void checkDuplicates(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, country]);

  async function loadText(text: string) {
    setRaw(text);
    setServerDuplicates(null);
    setError(null);
    await checkDuplicates(text);
  }

  async function checkDuplicates(text: string) {
    const phones = analyzeLeadCsv(text, country)
      .rows.filter((r) => r.status === "valid" && r.phone)
      .map((r) => r.phone!);
    if (phones.length === 0) return;
    setChecking(true);
    const found: ServerDuplicates = { inList: new Set(), inTenant: new Set(), suppressed: new Set() };
    try {
      for (let i = 0; i < phones.length; i += 2000) {
        const res = await fetch("/api/customer/lead-lists/duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId: listId ?? undefined, phones: phones.slice(i, i + 2000) }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { inList: string[]; inTenant: string[]; suppressed: string[] };
        data.inList.forEach((p) => found.inList.add(p));
        data.inTenant.forEach((p) => found.inTenant.add(p));
        data.suppressed.forEach((p) => found.suppressed.add(p));
      }
      setServerDuplicates(found);
    } finally {
      setChecking(false);
    }
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    void file.text().then(loadText);
  }

  function downloadInvalid() {
    if (!analysis) return;
    const bad = analysis.rows.filter((r) => r.status === "invalid" || r.status === "missing_phone");
    downloadTextFile(
      "ugyldige-leads.csv",
      toCsv(
        [...analysis.headers, "fejl"],
        bad.map((r) => [...r.raw, STATUS_LABELS[r.status]?.label ?? r.status])
      )
    );
  }

  async function sendChunks(
    rows: { phone: string; name?: string | null; company?: string | null; email?: string | null; notes?: string | null; customData?: Record<string, string> }[]
  ) {
    if (!listId && !newListName.trim()) {
      setError("Giv den nye liste et navn.");
      return;
    }
    setImporting(true);
    setError(null);
    let currentListId = listId;
    const totals = { inserted: 0, updated: 0, skippedDuplicates: 0, suppressed: 0, invalid: 0 };
    try {
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        setProgress(`Importerer ${Math.min(i + CHUNK_SIZE, rows.length)} af ${rows.length}…`);
        const res = await fetch("/api/customer/lead-lists/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(currentListId ? { listId: currentListId } : { newListName: newListName.trim() }),
            defaultCountry: country,
            duplicateMode,
            leads: rows.slice(i, i + CHUNK_SIZE),
          }),
        });
        if (!res.ok) {
          setError(await errorMessageOf(res, "Importen fejlede. Prøv igen."));
          return;
        }
        const data = await res.json();
        currentListId = data.listId;
        totals.inserted += data.inserted;
        totals.updated += data.updated;
        totals.skippedDuplicates += data.skippedDuplicates;
        totals.suppressed += data.suppressed;
        totals.invalid += data.invalid;
      }
      const parts = [`${totals.inserted} leads importeret`];
      if (totals.updated) parts.push(`${totals.updated} opdateret`);
      if (totals.skippedDuplicates) parts.push(`${totals.skippedDuplicates} dubletter sprunget over`);
      if (totals.suppressed) parts.push(`${totals.suppressed} på spærrelisten sprunget over`);
      if (totals.invalid) parts.push(`${totals.invalid} ugyldige sprunget over`);
      onImported({ listId: currentListId!, inserted: totals.inserted, message: parts.join(", ") + "." });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function importValid() {
    if (!analysis) return;
    const rows = analysis.rows
      .filter((r) => r.status === "valid")
      .map((r) => ({
        phone: r.phone!,
        name: r.name,
        company: r.company,
        email: r.email,
        notes: r.notes,
        customData: r.customData,
      }));
    if (rows.length === 0) {
      setError("Der er ingen gyldige leads at importere.");
      return;
    }
    void sendChunks(rows);
  }

  function addManual() {
    if (!manual.phone.trim()) {
      setError("Angiv et telefonnummer.");
      return;
    }
    // "by=Aarhus, branche=Webshop" → custom fields.
    const customData: Record<string, string> = {};
    for (const pair of manual.custom.split(/[,\n]/)) {
      const [key, ...rest] = pair.split("=");
      const value = rest.join("=").trim();
      if (key?.trim() && value) customData[key.trim().toLowerCase().replace(/\s+/g, "_")] = value;
    }
    void sendChunks([
      {
        phone: manual.phone,
        name: manual.name || null,
        company: manual.company || null,
        email: manual.email || null,
        notes: manual.notes || null,
        customData,
      },
    ]);
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("csv")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "csv" ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Upload CSV
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "manual" ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Tilføj lead manuelt
          </button>
        </div>
        <button
          type="button"
          onClick={() => downloadTextFile("aibooking-leads-skabelon.csv", LEAD_CSV_TEMPLATE)}
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Download CSV-skabelon
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fixedListId ? null : (
          <div>
            <label htmlFor="import-target" className="mb-1 block text-sm font-medium text-slate-700">
              Ringeliste
            </label>
            <select
              id="import-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setServerDuplicates(null);
              }}
              className={inputClass}
            >
              <option value="new">+ Ny liste…</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            {target === "new" ? (
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="Fx September leads"
                className={`${inputClass} mt-2`}
              />
            ) : null}
          </div>
        )}
        <div>
          <label htmlFor="import-country" className="mb-1 block text-sm font-medium text-slate-700">
            Land for numre uden landekode
          </label>
          <select
            id="import-country"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value as PhoneCountry);
              setServerDuplicates(null);
            }}
            className={inputClass}
          >
            {(Object.keys(PHONE_COUNTRIES) as PhoneCountry[]).map((code) => (
              <option key={code} value={code}>
                {COUNTRY_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === "manual" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} placeholder="Telefon *" className={inputClass} />
          <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Navn" className={inputClass} />
          <input value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} placeholder="Firma" className={inputClass} />
          <input value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} placeholder="E-mail" className={inputClass} />
          <input value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })} placeholder="Noter" className={`${inputClass} sm:col-span-2`} />
          <input
            value={manual.custom}
            onChange={(e) => setManual({ ...manual, custom: e.target.value })}
            placeholder="Ekstra felter, fx by=Aarhus, branche=Webshop"
            className={`${inputClass} sm:col-span-2`}
          />
        </div>
      ) : (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                CSV-fil {fileName ? <span className="font-normal text-slate-500">— {fileName}</span> : null}
              </span>
              <label className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700">
                Vælg fil
                <input type="file" accept=".csv,.txt,text/csv" onChange={handleFile} className="hidden" />
              </label>
            </div>
            <textarea
              rows={5}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setServerDuplicates(null);
              }}
              onBlur={() => raw.trim() && !serverDuplicates && void checkDuplicates(raw)}
              placeholder={"phone,name,company,email,city\n+4512345678,Jens Hansen,Eksempel ApS,jens@eksempel.dk,Aarhus"}
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-xs text-slate-500">
              Kun telefonnummer er påkrævet. Alle ekstra kolonner gemmes og kan bruges i AI-agentens prompt som fx{" "}
              <code>{"{{city}}"}</code>.
            </p>
          </div>

          {analysis && counts ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1">{counts.total} rækker</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{counts.valid} gyldige</span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{counts.invalid} ugyldige</span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{counts.missingPhone} mangler nummer</span>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{counts.duplicates} dubletter i filen</span>
                {serverDuplicates ? (
                  <>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{counts.existing} findes allerede</span>
                    <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{counts.suppressed} på spærrelisten</span>
                  </>
                ) : checking ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">Tjekker eksisterende leads…</span>
                ) : null}
                {counts.ambiguous ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                    {counts.ambiguous} med gættet landekode — tjek dem
                  </span>
                ) : null}
              </div>

              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Linje</th>
                      <th className="px-3 py-2">Navn</th>
                      <th className="px-3 py-2">Firma</th>
                      <th className="px-3 py-2">Telefon</th>
                      <th className="px-3 py-2">E-mail</th>
                      {analysis.customColumns.slice(0, 3).map((c) => (
                        <th key={c} className="px-3 py-2">
                          {c}
                        </th>
                      ))}
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analysis.rows.slice(0, PREVIEW_ROWS).map((row) => {
                      const status = STATUS_LABELS[rowStatus(row)]!;
                      return (
                        <tr key={row.line}>
                          <td className="px-3 py-1.5 text-slate-400">{row.line}</td>
                          <td className="px-3 py-1.5">{row.name ?? ""}</td>
                          <td className="px-3 py-1.5">{row.company ?? ""}</td>
                          <td className="px-3 py-1.5 font-mono">
                            {row.phone ?? <span className="text-red-600">{row.rawPhone || "—"}</span>}
                            {row.ambiguous ? <span className="ml-1 text-amber-600">?</span> : null}
                          </td>
                          <td className="px-3 py-1.5">{row.email ?? ""}</td>
                          {analysis.customColumns.slice(0, 3).map((c) => (
                            <td key={c} className="px-3 py-1.5">
                              {row.customData[c] ?? ""}
                            </td>
                          ))}
                          <td className={`px-3 py-1.5 font-medium ${status.className}`}>{status.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {analysis.rows.length > PREVIEW_ROWS ? (
                <p className="text-xs text-slate-500">Viser de første {PREVIEW_ROWS} af {analysis.rows.length} rækker.</p>
              ) : null}

              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-medium text-slate-700">Numre I allerede har</legend>
                {(
                  [
                    ["skip", "Spring dubletter over (anbefalet)"],
                    ["import", "Importer dem alligevel"],
                    ["update", "Opdater det eksisterende lead"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" checked={duplicateMode === value} onChange={() => setDuplicateMode(value)} />
                    {label}
                  </label>
                ))}
              </fieldset>
            </div>
          ) : null}
        </>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {progress ? <p className="text-sm text-slate-500">{progress}</p> : null}

      <div className="flex flex-wrap gap-3">
        {onCancel ? (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Annuller
          </button>
        ) : null}
        {mode === "manual" ? (
          <button type="button" onClick={addManual} disabled={importing} className={primaryButtonClass}>
            {importing ? "Gemmer…" : "Tilføj lead"}
          </button>
        ) : (
          <>
            <button type="button" onClick={importValid} disabled={importing || !counts?.valid} className={primaryButtonClass}>
              {importing ? "Importerer…" : `Importer ${counts?.valid ?? 0} gyldige leads`}
            </button>
            {counts && counts.invalid + counts.missingPhone > 0 ? (
              <button type="button" onClick={downloadInvalid} className={secondaryButtonClass}>
                Download ugyldige rækker
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
