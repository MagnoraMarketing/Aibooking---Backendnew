import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { IntroOfferButton } from "@/components/dashboard/intro-offer-button";
import type { Customer } from "@/types/database";

export const dynamic = "force-dynamic";

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

const INCLUDED = [
  { title: "1 testnummer", description: "Jeres eget Twilio-nummer, klar til at viderestille til med det samme." },
  {
    title: "Op til 75 min. taletid",
    description: "Twilios egen gratis-kvote til en ny Twilio-konto, brugt til at teste agenten live på opkald.",
  },
  {
    title: "Fuld PRO-adgang",
    description: "Alle funktioner i AIbooking.dk-platformen låst op — agent, widget, kalender, det hele.",
  },
];

const STEPS = [
  {
    title: "Betal 499 kr for de første 30 dage",
    description: "Via Stripe — sikker betaling, kvittering på mail. Herefter fortsætter det automatisk til normalpris.",
  },
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
];

export default async function InboundFreeTrialPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: customer }, { data: subscription }] = await Promise.all([
    supabase
      .from("customers")
      .select("intro_offer_used_at")
      .eq("id", customerId)
      .single<Pick<Customer, "intro_offer_used_at">>(),
    supabase.from("subscriptions").select("id").eq("customer_id", customerId).maybeSingle(),
  ]);

  const offerAvailable = !customer?.intro_offer_used_at && !subscription;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-3">
        <span className="inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
          Introtilbud
        </span>
        <h1 className="text-3xl font-semibold text-slate-900">
          Prøv AIbooking.dk Reception i 30 dage for <span className="text-brand-600">499 kr</span>
        </h1>
        <p className="text-base text-slate-600">
          En AI-receptionist der besvarer jeres opkald, booker aftaler og aldrig går glip af en kunde — sæt den op på
          jeres eget telefonnummer i dag.
        </p>
      </div>

      {offerAvailable ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">499 kr</span>
            <span className="text-sm text-slate-500">for de første 30 dage, derefter 999 kr/md — fortsætter automatisk</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {INCLUDED.map((item) => (
              <div key={item.title} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-800">{item.title}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{item.description}</p>
              </div>
            ))}
          </div>
          <IntroOfferButton className="mt-5 rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            Prøv nu — 499 kr for 30 dage →
          </IntroOfferButton>
          <p className="mt-3 text-xs text-slate-500">
            Betales sikkert via Stripe. I kan opsige når som helst under Betaling. De 75 gratis minutter er Twilios
            egen kvote til en ny Twilio-konto — har I allerede en Twilio-konto, kan jeres saldo se anderledes ud.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          {customer?.intro_offer_used_at
            ? "I har allerede brugt introtilbuddet — men kan stadig forbinde flere numre under Inbound."
            : "I har allerede et abonnement — introtilbuddet er kun for nye kunder."}
          <div className="mt-3">
            <Link
              href="/dashboard/inbound"
              className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Gå til Inbound →
            </Link>
          </div>
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
          dage til det, helt uafhængigt af introtilbuddet ovenfor.
        </p>
      </div>
    </div>
  );
}
