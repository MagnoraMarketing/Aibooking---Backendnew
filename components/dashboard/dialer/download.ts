// Hands the browser a generated file (CSV template, invalid rows) to save.
export function downloadTextFile(filename: string, content: string, type = "text/csv;charset=utf-8") {
  // A BOM so Excel opens æ, ø and å as the letters they are.
  const blob = new Blob(["﻿", content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";
export const primaryButtonClass =
  "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";
export const secondaryButtonClass =
  "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export async function errorMessageOf(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error?.message ?? fallback;
}
