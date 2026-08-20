"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

// Wraps a field that's visible (matches the reference design) but not yet
// backed by anything real in this backend — greys it out and labels it
// instead of pretending it works.
export function ComingSoonField({ label, children }: { label: string; children?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none select-none opacity-50">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {t("dashboardPages.shared.comingSoon")}
        </span>
      </div>
      {children}
    </div>
  );
}
