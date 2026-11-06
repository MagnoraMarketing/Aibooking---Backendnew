import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { hasEmbedCodeAccess } from "@/lib/billing";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { getBalanceSeconds } from "@/lib/credits";
import type { Customer, Subscription, Widget } from "@/types/database";
import { translate } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

interface Step {
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
  // Steps we can't verify server-side (e.g. "did you actually forward your
  // phone") show as an action item instead of a checkmark once unlocked.
  trackable: boolean;
  // Phone steps don't apply to a customer who only wants a website widget —
  // they are shown as optional and left out of the progress count until the
  // customer has a phone agent.
  optional?: boolean;
}

export default async function GettingStartedPage() {
  const ctx = await requireCustomerAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => {
    const text = translate(locale, key);
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, k: string) => (k in vars ? String(vars[k]) : match));
  };
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: phoneNumbers }, { data: connections }, { data: customer }, { data: subscription }, balanceSeconds] =
    await Promise.all([
      supabase.from("widgets").select("*").eq("customer_id", customerId).returns<Widget[]>(),
      supabase.from("phone_numbers").select("id").eq("customer_id", customerId).eq("purchase_status", "active"),
      supabase.from("calendar_connections").select("id").eq("customer_id", customerId),
      supabase.from("customers").select("*").eq("id", customerId).single<Customer>(),
      supabase
        .from("subscriptions")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<Subscription>(),
      getBalanceSeconds(customerId),
    ]);

  // Newest widget agent first: that's the one a customer is most likely
  // setting up right now. Every check below looks at all agents, not just
  // whichever row the database happened to return first.
  const sortedWidgets = [...(widgets ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const firstWidget = sortedWidgets.find((w) => w.agent_type !== "phone") ?? sortedWidgets[0] ?? null;
  const hasWidget = Boolean(firstWidget);
  const hasPhoneAgent = sortedWidgets.some((w) => w.agent_type === "phone");
  // Every agent starts with the platform's default prompt (signup and the
  // create route both seed it), so a non-empty prompt alone said "done" before
  // the customer had written a word. Done means changed from that default.
  const defaultPrompt = (await getDefaultSystemPrompt()).trim();
  const hasConfiguredPrompt = sortedWidgets.some((w) => {
    const prompt = w.system_prompt?.trim();
    return Boolean(prompt) && prompt !== defaultPrompt;
  });
  const embedCodeUnlocked = customer
    ? hasEmbedCodeAccess({
        customerCreatedAt: customer.created_at,
        subscriptionStatus: subscription?.status ?? null,
        balanceSeconds,
        widgetLaunchPaidAt: customer.widget_launch_paid_at,
        customerType: customer.customer_type,
      })
    : false;
  const hasPhoneNumber = (phoneNumbers?.length ?? 0) > 0;
  const hasCalendar = (connections?.length ?? 0) > 0;

  const agentHref = firstWidget ? `/dashboard/agent/${firstWidget.id}` : "/dashboard/agent";

  const steps: Step[] = [
    {
      title: t("dashboardPages.getting-started.step1Title"),
      description: t("dashboardPages.getting-started.step1Description"),
      href: "/dashboard/agent",
      cta: t(hasWidget ? "dashboardPages.getting-started.step1CtaDone" : "dashboardPages.getting-started.step1CtaNotDone"),
      done: hasWidget,
      trackable: true,
    },
    {
      title: t("dashboardPages.getting-started.step2Title"),
      description: t("dashboardPages.getting-started.step2Description"),
      href: `${agentHref}?tab=prompt`,
      cta: t("dashboardPages.getting-started.step2Cta"),
      done: hasConfiguredPrompt,
      trackable: true,
    },
    {
      title: t("dashboardPages.getting-started.step3Title"),
      description: t("dashboardPages.getting-started.step3Description"),
      href: "/dashboard/inbound",
      cta: t(hasPhoneNumber ? "dashboardPages.getting-started.step3CtaDone" : "dashboardPages.getting-started.step3CtaNotDone"),
      done: hasPhoneNumber,
      trackable: true,
      optional: !hasPhoneAgent,
    },
    {
      title: t("dashboardPages.getting-started.step4Title"),
      description: t("dashboardPages.getting-started.step4Description"),
      href: "/dashboard/inbound",
      cta: t("dashboardPages.getting-started.step4Cta"),
      done: hasPhoneNumber,
      trackable: false,
      optional: !hasPhoneAgent,
    },
    {
      title: t("dashboardPages.getting-started.step5Title"),
      description: t("dashboardPages.getting-started.step5Description"),
      href: "/dashboard/integrations",
      cta: t(hasCalendar ? "dashboardPages.getting-started.step5CtaDone" : "dashboardPages.getting-started.step5CtaNotDone"),
      done: hasCalendar,
      trackable: true,
    },
    {
      title: t("dashboardPages.getting-started.step6Title"),
      description: t("dashboardPages.getting-started.step6Description"),
      href: `${agentHref}?tab=embed`,
      cta: t("dashboardPages.getting-started.step6Cta"),
      done: embedCodeUnlocked && hasWidget,
      trackable: true,
    },
  ];

  const countedSteps = steps.filter((s) => !s.optional);
  const completedCount = countedSteps.filter((s) => s.done).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("dashboardPages.getting-started.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("dashboardPages.getting-started.subtitle", { completed: completedCount, total: countedSteps.length })}
        </p>
        <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${(completedCount / countedSteps.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="space-y-3">
        {steps.map((step) => (
          <li
            key={step.title}
            className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5 ${
              step.optional ? "border-dashed border-slate-200" : "border-slate-200"
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
                }`}
              >
                {step.done ? "✓" : ""}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {step.title}
                  {step.optional ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {t("agentFlow.gettingStarted.optional")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">{step.description}</p>
                {!step.trackable && step.done ? (
                  <p className="mt-1 text-xs font-medium text-amber-600">
                    {t("dashboardPages.getting-started.rememberStep")}
                  </p>
                ) : null}
              </div>
            </div>
            <Link
              href={step.href}
              className="shrink-0 rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 sm:py-2"
            >
              {step.cta} →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
