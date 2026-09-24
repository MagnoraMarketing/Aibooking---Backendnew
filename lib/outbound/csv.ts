import { normalizePhone, type PhoneCountry } from "./phone";

// Lead import: from a CSV file (or pasted lines) to rows the dialer and the
// AI agent can use.
//
// Runs in the browser for the preview and again on the server for the
// actual import, so what the customer approved is what gets stored — never
// something the server re-guessed differently. Pure functions only.
//
// Any column that is not one of the known fields is kept, under its header,
// in custom_data. That is the point of it: "{{city}}" and "{{industry}}" in
// an AI agent's prompt come from exactly these columns.

export const LEAD_CSV_TEMPLATE =
  "phone,name,company,email,city,industry,notes\n" +
  "+4512345678,Jens Hansen,Eksempel ApS,jens@eksempel.dk,Aarhus,Webshop,Interesseret i en demo\n";

export const MAX_IMPORT_ROWS = 5000;

type KnownField = "phone" | "name" | "company" | "email" | "notes";

const HEADER_ALIASES: Record<string, KnownField> = {
  phone: "phone",
  phone_number: "phone",
  phonenumber: "phone",
  telefon: "phone",
  telefonnummer: "phone",
  tlf: "phone",
  mobil: "phone",
  mobile: "phone",
  nummer: "phone",
  number: "phone",
  name: "name",
  navn: "name",
  full_name: "name",
  kontaktperson: "name",
  contact: "name",
  company: "company",
  firma: "company",
  virksomhed: "company",
  firmanavn: "company",
  email: "email",
  e_mail: "email",
  mail: "email",
  notes: "notes",
  note: "notes",
  noter: "notes",
};

// "Postnr." -> "postnr", "Branche / type" -> "branche_type". What the
// customer will type between {{ }} in a prompt, so kept readable.
export function normalizeColumnKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s\-/.]+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// RFC 4180-ish: quoted fields, "" as an escaped quote, newlines inside
// quotes. The delimiter is guessed from the first line — Danish Excel saves
// "CSV" with semicolons.
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
        ? "\t"
        : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export type ImportRowStatus = "valid" | "invalid" | "missing_phone" | "duplicate";

export interface ImportRow {
  // 1-based line in the file, header included, so the customer can find it.
  line: number;
  rawPhone: string;
  phone: string | null;
  name: string | null;
  company: string | null;
  email: string | null;
  notes: string | null;
  customData: Record<string, string>;
  status: ImportRowStatus;
  // Guessed a country code ("4512345678"). Imported, but shown.
  ambiguous: boolean;
  // The row as it was in the file, for "download invalid rows".
  raw: string[];
}

export interface ImportAnalysis {
  headers: string[];
  customColumns: string[];
  rows: ImportRow[];
  summary: { total: number; valid: number; invalid: number; missingPhone: number; duplicates: number };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: string | undefined, max = 500): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function analyzeLeadCsv(text: string, defaultCountry: PhoneCountry = "DK"): ImportAnalysis {
  const table = parseCsv(text).slice(0, MAX_IMPORT_ROWS + 1);
  if (table.length === 0) {
    return { headers: [], customColumns: [], rows: [], summary: { total: 0, valid: 0, invalid: 0, missingPhone: 0, duplicates: 0 } };
  }

  // A header row is one that names a phone column. Without one, the old
  // "number, name, company" line format still works, so a pasted list of
  // numbers needs no header at all.
  const firstRow = table[0]!;
  const mapped = firstRow.map((cell) => HEADER_ALIASES[normalizeColumnKey(cell)] ?? null);
  const hasHeader = mapped.includes("phone");

  const headers = hasHeader ? firstRow.map((cell) => cell.trim()) : ["phone", "name", "company"];
  const fieldOf: (KnownField | null)[] = hasHeader ? mapped : ["phone", "name", "company"];
  const customKeys = headers.map((header, index) => (fieldOf[index] ? null : normalizeColumnKey(header) || null));

  const dataRows = hasHeader ? table.slice(1) : table;
  const seen = new Set<string>();
  const rows: ImportRow[] = dataRows.slice(0, MAX_IMPORT_ROWS).map((cells, index) => {
    const values: Partial<Record<KnownField, string>> = {};
    const customData: Record<string, string> = {};
    cells.forEach((cell, column) => {
      const field = fieldOf[column];
      if (field) {
        if (values[field] === undefined) values[field] = cell;
      } else {
        const key = customKeys[column];
        const value = cell.trim();
        if (key && value) customData[key] = value.slice(0, 500);
      }
    });

    const phoneResult = normalizePhone(values.phone, defaultCountry);
    const email = clean(values.email, 320);

    let status: ImportRowStatus;
    if (!phoneResult.ok) status = phoneResult.reason === "missing" ? "missing_phone" : "invalid";
    else if (email && !EMAIL_REGEX.test(email)) status = "invalid";
    else if (seen.has(phoneResult.e164)) status = "duplicate";
    else status = "valid";
    if (phoneResult.ok && status === "valid") seen.add(phoneResult.e164);

    return {
      line: index + (hasHeader ? 2 : 1),
      rawPhone: (values.phone ?? "").trim(),
      phone: phoneResult.ok ? phoneResult.e164 : null,
      name: clean(values.name, 200),
      company: clean(values.company, 200),
      email,
      notes: clean(values.notes, 2000),
      customData,
      status,
      ambiguous: phoneResult.ok && phoneResult.ambiguous,
      raw: cells,
    };
  });

  return {
    headers,
    customColumns: customKeys.filter((key): key is string => Boolean(key)),
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => r.status === "valid").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
      missingPhone: rows.filter((r) => r.status === "missing_phone").length,
      duplicates: rows.filter((r) => r.status === "duplicate").length,
    },
  };
}

function csvCell(value: string): string {
  return /[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map((cell) => csvCell(cell ?? "")).join(",")).join("\n") + "\n";
}

// Lead fields an AI agent's prompt can refer to as {{name}}, {{company}} …
// Known fields first, then every custom column. Empty values are left out
// rather than sent as "" — an agent told a name is "" says so out loud.
export function leadVariables(lead: {
  phone: string;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  customData?: Record<string, unknown> | null;
}): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(lead.customData ?? {})) {
    if (typeof value === "string" && value.trim()) variables[key] = value.trim();
    else if (typeof value === "number" || typeof value === "boolean") variables[key] = String(value);
  }
  variables.phone = lead.phone;
  if (lead.name) variables.name = lead.name;
  if (lead.company) variables.company = lead.company;
  if (lead.email) variables.email = lead.email;
  return variables;
}
