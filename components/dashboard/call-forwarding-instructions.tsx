// The GSM call-diversion codes (**21*, **61*, ##002# etc.) are a 3GPP MMI
// standard, not carrier-specific — they work the same way on every Danish
// operator (YouSee/TDC, Telenor, Telia, 3), which is why this can show one
// generic set of steps instead of a per-operator lookup.
interface CallForwardingInstructionsProps {
  phoneNumber: string;
}

export function CallForwardingInstructions({ phoneNumber }: CallForwardingInstructionsProps) {
  const digits = phoneNumber.replace(/\s/g, "");

  const steps = [
    {
      label: "Viderestil alle opkald (anbefalet)",
      code: `**21*${digits}#`,
      description: "Alle opkald til jeres eksisterende nummer går direkte til AI-agenten.",
    },
    {
      label: "Viderestil kun ved optaget/ingen svar",
      code: `**61*${digits}#`,
      description: "I besvarer selv opkald som normalt — agenten tager kun over, når I ikke kan svare.",
    },
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Viderestil jeres nummer</h2>
        <p className="mt-1 text-sm text-slate-500">
          Ring koden op fra den mobil eller det fastnet-nummer, kunderne allerede ringer til, og tryk opkald/grøn
          knap. Virker på alle danske teleselskaber (YouSee/TDC, Telenor, Telia, 3).
        </p>
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
        <p className="font-medium">Sådan slår I viderestilling fra igen</p>
        <p className="mt-1">
          Ring <code className="rounded bg-white px-1.5 py-0.5">##002#</code> og tryk opkald — det annullerer al
          viderestilling og I modtager opkald direkte igen.
        </p>
      </div>
    </div>
  );
}
