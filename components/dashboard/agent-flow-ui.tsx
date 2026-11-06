"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

// Shared building blocks for the agent creation flow and the agent page, so
// every step looks and behaves the same: one heading, one explanation, the
// step's own content, and the same row of buttons at the bottom. On a phone
// the buttons stack full-width (primary on top, in thumb reach); from sm and
// up they sit in a row, Back on the left and the way forward on the right.

export interface FlowStep {
  key: string;
  label: string;
}

// "Trin 3 af 7 · Prompt" plus a bar on small screens — a row of seven
// numbered circles does not fit a phone, and labels were hidden there
// entirely, so a customer on mobile could not tell where they were. From sm
// and up every step is listed by name, finished ones can be clicked to go
// back.
export function FlowProgress({
  steps,
  current,
  onSelect,
}: {
  steps: FlowStep[];
  current: number;
  onSelect?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const percent = Math.round(((current + 1) / steps.length) * 100);

  return (
    <div>
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("agentFlow.progress.stepOf", { current: current + 1, total: steps.length })}
          </p>
          <p className="truncate text-sm font-semibold text-slate-900">{steps[current]?.label}</p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <ol className="hidden items-center gap-1 sm:flex">
        {steps.map(({ key, label }, i) => {
          const done = i < current;
          const active = i === current;
          const clickable = done && onSelect;
          return (
            <li key={key} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect(i)}
                aria-current={active ? "step" : undefined}
                className={`flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left ${
                  clickable ? "hover:bg-slate-50" : "cursor-default"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done ? "bg-emerald-500 text-white" : active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`truncate text-xs font-medium ${active ? "text-slate-900" : done ? "text-slate-600" : "text-slate-400"}`}
                >
                  {label}
                </span>
              </button>
              {i < steps.length - 1 ? (
                <span className={`h-px min-w-2 flex-1 ${done ? "bg-emerald-500" : "bg-slate-200"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function StepHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

export const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60 sm:w-auto sm:py-2";
export const secondaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:w-auto sm:py-2";

export function StepFooter({
  onBack,
  backLabel,
  onSkip,
  skipLabel,
  primary,
}: {
  onBack?: () => void;
  backLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
  primary?: { label: string; onClick: () => void; disabled?: boolean; subtle?: boolean };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {onBack ? (
          <button type="button" onClick={onBack} className={secondaryButtonClass}>
            {backLabel ?? t("agent.wizard.backArrow")}
          </button>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {onSkip ? (
          <button type="button" onClick={onSkip} className={secondaryButtonClass}>
            {skipLabel ?? t("common.skip")}
          </button>
        ) : null}
        {primary ? (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={primary.disabled}
            className={primary.subtle ? secondaryButtonClass : primaryButtonClass}
          >
            {primary.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? t("dashboardPages.shared.statusActive") : t("dashboardPages.shared.widgetStatusPaused")}
    </span>
  );
}
