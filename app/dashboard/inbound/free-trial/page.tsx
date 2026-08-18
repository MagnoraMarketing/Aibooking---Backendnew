import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import type { Customer } from "@/types/database";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const BENEFITS = [
  {
    title: "Svarer altid — også uden for åbningstid",
    description:
      "Jeres AI-receptionist tager opkaldet med det samme, dag og nat. Ingen kunder lagt i kø, ingen tabte opkald til konkurrenten.",
  },
  {
    title: "Taler naturligt dansk",
    description:
      "Bygget på Claude og ElevenLabs — svarer flydende og forståeligt, ikke robotagtige menuvalg eller \"tryk 1 for...\".",
  },
  {
    title: "Booker direkte i jeres kalender",
    description: "Forbind Google Kalender, Outlook eller Cal.com, og lad agenten aftale og bekræfte tider selv.",
  },
  {
    title: "Samler leads og kundeoplysninger",
    description: "Hver samtale gemmes og opsummeres automatisk, så I aldrig mister kontekst fra et opkald.",
  },
  {
    title: "Jeres eget nummer — jeres kontrol",
    description:
      "I bruger jeres eget Twilio-nummer og viderestiller blot jeres eksisterende firmanummer til det. Stil viderestillingen tilbage når som helst.",
  },
];

const STEPS = [
  {
    title: "Forbind jeres Twilio-konto",
    description:
      "Har I ikke allerede en, opretter I en gratis konto hos Twilio på 2 minutter. Indtast Account SID og Auth Token i vores popup, og vælg nummeret fra en dropdown — I skal ikke taste noget manuelt.",
  },
  {
    title: "Viderestil jeres eksisterende nummer",
    description:
      "Stil jeres firmanummer om til at viderestille til det nye nummer. Det er den eneste ændring — jeres nuværende opsætning rører vi ikke ved.",
  },
  {
    title: "Test det live i 30 dage",
    description:
      "Ring ind, prøv agenten af, og se hvordan den håndterer rigtige opkald — helt gratis, ingen binding, ingen betalingskort.",
  },
];

export default async function InboundFreeTrialPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: customer } = await supabase
    .from("customers")
    .select("byo_trial_expires_at")
    .eq("id", customerId)
    .single<Pick<Customer, "byo_trial_expires_at">>();

  const byoTrialExpiresAt = customer?.byo_trial_expires_at ?? null;
  const byoTrialActive = byoTrialExpiresAt !== null && new Date(byoTrialExpiresAt).getTime() > Date.now();
  const byoTrialUsed = byoTrialExpiresAt !== null;
  const byoTrialDaysLeft = byoTrialActive
    ? Math.max(0, Math.ceil((new Date(byoTrialExpiresAt as string).getTime() - Date.now()) / MS_PER_DAY))
    : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-3">
        <span className="inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
          Risikofrit
        </span>
        <h1 className="text-3xl font-semibold text-slate-900">Prøv AIbooking.dk Reception gratis i 30 dage</h1>
        <p className="text-base text-slate-600">
          En AI-receptionist der besvarer jeres opkald, booker aftaler og aldrig går glip af en kunde — prøv den live
          på jeres eget telefonnummer, uden at ændre noget ved jeres nuværende opsætning.
        </p>
      </div>

      {byoTrialActive ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          🎉 I er allerede i gang — <strong>{byoTrialDaysLeft} {byoTrialDaysLeft === 1 ? "dag" : "dage"}</strong> tilbage
          af jeres gratis PRO-prøveperiode.
          <div className="mt-3">
            <Link
              href="/dashboard/inbound"
              className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Gå til Inbound →
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Link
            href="/dashboard/inbound?openTrial=1"
            className="inline-block rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700"
          >
            Kom i gang — forbind jeres Twilio-nummer →
          </Link>
          {byoTrialUsed ? (
            <p className="mt-3 text-xs text-slate-500">
              Jeres 30-dages prøveperiode er brugt. Se abonnementer under{" "}
              <Link href="/dashboard/billing" className="font-medium text-brand-600 hover:text-brand-700">
                Betaling
              </Link>
              .
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Ingen binding. Ingen betalingskort krævet.</p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Det får I med AIbooking.dk Reception</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <div key={benefit.title} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">{benefit.title}</p>
              <p className="mt-1 text-sm text-slate-600">{benefit.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Sådan fungerer det</h2>
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                <p className="mt-1 text-sm text-slate-600">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-semibold text-slate-800">Ikke klar til at forbinde et telefonnummer endnu?</p>
        <p className="mt-1 text-sm text-slate-600">
          I har allerede adgang til at prøve chat- og stemme-widgetten uden Twilio — test den visuelt under{" "}
          <Link href="/dashboard/agent" className="font-medium text-brand-600 hover:text-brand-700">
            Test Agent
          </Link>
          , eller læg den direkte ind på jeres hjemmeside med embed-koden. Alle nye konti får 5 gratis minutter i 7
          dage til det, helt uafhængigt af telefon-prøveperioden ovenfor.
        </p>
      </div>
    </div>
  );
}
