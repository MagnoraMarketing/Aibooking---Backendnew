"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";
import { CallForwardingInstructions } from "../call-forwarding-instructions";

interface ExistingPhoneNumber {
  widget_id: string;
  source: string;
  purchase_status: string;
  phone_number: string;
  released_at: string | null;
}

type Status = "checking" | "provisioning" | "ready" | "error" | "paymentRequired";

// The final wizard step for a Telefon (Inbound/Outbound) agent — the
// counterpart to EmbedCodeTab for a Voice Widget agent. The widget already
// exists in the DB by the time this step renders (see
// agent-creation-wizard.tsx's stepsFor), so there's nothing left to lose by
// provisioning eagerly: this step automatically assigns the agent a free
// Vapi-hosted inbound number the moment it mounts, and shows the forwarding
// codes right here — see app/api/customer/phone-numbers/vapi/route.ts and
// supabase/migrations/0037_vapi_inbound_numbers.sql. The Inbound dashboard
// page remains the place to release a number, add more agents, or pick from
// spare numbers the platform already owns.
export function WizardPhoneStep({ widget }: { widget: WidgetWithExtras }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("checking");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      // A widget this step already ran for (the customer stepped back and
      // forward again) already has its number — reuse it instead of trying
      // to provision a second one, which the API would reject outright.
      const existingRes = await fetch("/api/customer/phone-numbers");
      const existingBody = existingRes.ok ? await existingRes.json().catch(() => null) : null;
      const current = (existingBody?.phoneNumbers as ExistingPhoneNumber[] | undefined)?.find(
        (p) => p.widget_id === widget.id && p.source === "vapi" && p.purchase_status === "active" && !p.released_at
      );
      if (current) {
        setPhoneNumber(current.phone_number);
        setStatus("ready");
        return;
      }

      setStatus("provisioning");
      const res = await fetch("/api/customer/phone-numbers/vapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetId: widget.id }),
      });

      if (!res.ok) {
        if (res.status === 402) {
          setStatus("paymentRequired");
          return;
        }
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? t("agent.wizardPhone.errorGetNumber"));
        setStatus("error");
        return;
      }

      const { phoneNumber: created } = await res.json();
      setPhoneNumber(created.phone_number);
      setStatus("ready");
    })();
  }, [widget.id, t]);

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.wizardPhone.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("agent.wizardPhone.description", { name: widget.name })}</p>
      </div>

      {status === "checking" || status === "provisioning" ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {t("agent.wizardPhone.provisioning")}
        </div>
      ) : null}

      {status === "ready" && phoneNumber ? <CallForwardingInstructions phoneNumber={phoneNumber} /> : null}

      {status === "paymentRequired" ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>{t("agent.wizardPhone.paymentRequired", { name: widget.name })}</p>
          <Link href="/dashboard/inbound/free-trial" className="inline-block font-medium text-amber-900 hover:underline">
            {t("agent.wizardPhone.paymentRequiredCta")}
          </Link>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <Link
        href="/dashboard/inbound"
        className="inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        {t("agent.wizardPhone.connectButton")}
      </Link>
    </div>
  );
}
