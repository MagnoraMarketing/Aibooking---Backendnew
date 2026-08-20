"use client";

import { useTranslation } from "@/components/i18n/language-provider";

// The GSM call-diversion codes (**21*, **61*, ##002# etc.) are a 3GPP MMI
// standard, not carrier-specific — they work the same way on every Danish
// operator (YouSee/TDC, Telenor, Telia, 3), which is why this can show one
// generic set of steps instead of a per-operator lookup.
interface CallForwardingInstructionsProps {
  phoneNumber: string;
}

export function CallForwardingInstructions({ phoneNumber }: CallForwardingInstructionsProps) {
  const { t } = useTranslation();
  const digits = phoneNumber.replace(/\s/g, "");

  const steps = [
    {
      label: t("dashboardPages.call-forwarding.step1Label"),
      code: `**21*${digits}#`,
      description: t("dashboardPages.call-forwarding.step1Description"),
    },
    {
      label: t("dashboardPages.call-forwarding.step2Label"),
      code: `**61*${digits}#`,
      description: t("dashboardPages.call-forwarding.step2Description"),
    },
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("dashboardPages.call-forwarding.heading")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("dashboardPages.call-forwarding.description")}</p>
      </div>

      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.code} className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-800">{step.label}</p>
            <p className="mt-1 text-xs text-slate-500">{step.description}</p>
            <code className="mt-2 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
              {step.code}
            </code>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-amber-50 p-4 text-xs text-amber-800">
        <p className="font-medium">{t("dashboardPages.call-forwarding.disableHeading")}</p>
        <p className="mt-1">
          {t("dashboardPages.call-forwarding.disableDescription", {
            code: "##002#",
          }).split("##002#").map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 ? <code className="rounded bg-white px-1.5 py-0.5">##002#</code> : null}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
