import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { IntroOfferButton } from "@/components/dashboard/intro-offer-button";
import type { Customer } from "@/types/database";
import { translate } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

export default async function InboundFreeTrialPage() {
  const ctx = await requireCustomerAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
  const t = (key: string) => translate(locale, key);

  const BENEFITS = [
    {
      title: t("dashboardPages.inbound-free-trial.benefit1Title"),
      description: t("dashboardPages.inbound-free-trial.benefit1Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.benefit2Title"),
      description: t("dashboardPages.inbound-free-trial.benefit2Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.benefit3Title"),
      description: t("dashboardPages.inbound-free-trial.benefit3Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.benefit4Title"),
      description: t("dashboardPages.inbound-free-trial.benefit4Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.benefit5Title"),
      description: t("dashboardPages.inbound-free-trial.benefit5Description"),
    },
  ];

  const INCLUDED = [
    {
      title: t("dashboardPages.inbound-free-trial.included1Title"),
      description: t("dashboardPages.inbound-free-trial.included1Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.included2Title"),
      description: t("dashboardPages.inbound-free-trial.included2Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.included3Title"),
      description: t("dashboardPages.inbound-free-trial.included3Description"),
    },
  ];

  const STEPS = [
    {
      title: t("dashboardPages.inbound-free-trial.step1Title"),
      description: t("dashboardPages.inbound-free-trial.step1Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.step2Title"),
      description: t("dashboardPages.inbound-free-trial.step2Description"),
    },
    {
      title: t("dashboardPages.inbound-free-trial.step3Title"),
      description: t("dashboardPages.inbound-free-trial.step3Description"),
    },
  ];

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
          {t("dashboardPages.shared.introOfferBadge")}
        </span>
        <h1 className="text-3xl font-semibold text-slate-900">
          {t("dashboardPages.inbound-free-trial.heroTitlePrefix")}{" "}
          <span className="text-brand-600">499 kr</span>
        </h1>
        <p className="text-base text-slate-600">{t("dashboardPages.inbound-free-trial.heroDescription")}</p>
      </div>

      {offerAvailable ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">499 kr</span>
            <span className="text-sm text-slate-500">{t("dashboardPages.inbound-free-trial.priceSubtitle")}</span>
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
            {t("dashboardPages.inbound-free-trial.startButton")}
          </IntroOfferButton>
          <p className="mt-3 text-xs text-slate-500">{t("dashboardPages.inbound-free-trial.startDisclaimer")}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          {customer?.intro_offer_used_at
            ? t("dashboardPages.inbound-free-trial.alreadyUsedOffer")
            : t("dashboardPages.inbound-free-trial.alreadySubscribed")}
          <div className="mt-3">
            <Link
              href="/dashboard/inbound"
              className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("dashboardPages.inbound-free-trial.goToInbound")}
            </Link>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("dashboardPages.inbound-free-trial.benefitsHeading")}
        </h2>
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
        <h2 className="text-lg font-semibold text-slate-900">
          {t("dashboardPages.inbound-free-trial.howItWorksHeading")}
        </h2>
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
        <p className="text-sm font-semibold text-slate-800">
          {t("dashboardPages.inbound-free-trial.notReadyTitle")}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {t("dashboardPages.inbound-free-trial.notReadyDescriptionPrefix")}{" "}
          <Link href="/dashboard/agent" className="font-medium text-brand-600 hover:text-brand-700">
            {t("dashboardPages.inbound-free-trial.testAgentLink")}
          </Link>
          {t("dashboardPages.inbound-free-trial.notReadyDescriptionSuffix")}
        </p>
      </div>
    </div>
  );
}
