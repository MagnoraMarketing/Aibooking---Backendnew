"use client";

import Link from "next/link";
import type { WidgetWithExtras } from "../agent-configurator";

// The final wizard step for a Telefon (Inbound/Outbound) agent — the
// counterpart to EmbedCodeTab for a Voice Widget agent. There's no embed
// snippet for a phone-only agent; instead this hands off to the Inbound
// page, which already owns the full "buy a number / bring your own Twilio
// number" flow (including the 30-day free trial popup) — no need to
// duplicate any of that here.
export function WizardPhoneStep({ widget }: { widget: WidgetWithExtras }) {
  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Telefonnummer</h2>
        <p className="mt-1 text-sm text-slate-500">
          {widget.name} er klar til at besvare og foretage opkald. Sidste trin er at forbinde et telefonnummer, så I
          kan komme i gang.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Under Inbound kan I enten købe et nummer gennem os (inkluderet i jeres pakke) eller forbinde jeres eget
        Twilio-nummer helt gratis i 30 dage — begge dele klarer I på under et minut.
      </div>

      <Link
        href="/dashboard/inbound"
        className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Forbind telefonnummer →
      </Link>
    </div>
  );
}
