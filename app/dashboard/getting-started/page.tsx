import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { hasEmbedCodeAccess } from "@/lib/billing";
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

  const firstWidget = widgets?.[0] ?? null;
  const hasWidget = Boolean(firstWidget);
  const hasConfiguredPrompt = Boolean(firstWidget?.system_prompt?.trim());
  const embedCodeUnlocked = customer
    ? hasEmbedCodeAccess({
        customerCreatedAt: customer.created_at,
        subscriptionStatus: subscription?.status ?? null,
        balanceSeconds,
      })
    : false;
  const hasPhoneNumber = (phoneNumbers?.length ?? 0) > 0;
  const hasCalendar = (connections?.length ?? 0) > 0;

  const agentHref = firstWidget ? `/dashboard/agent/${firstWidget.id}` : "/dashboard/agent";

  const steps: Step[] = [
    {
      title: "1. Opret jeres agent",
      description: "Giv agenten et navn og vælg hvilken AI-model den skal bruge.",
      href: "/dashboard/agent",
      cta: hasWidget ? "Se agenter" : "Opret agent",
      done: hasWidget,
      trackable: true,
    },
    {
      title: "2. Skriv prompt og vælg stemme",
      description: "Fortæl agenten om jeres virksomhed, og vælg en dansk stemme under Prompt Lab / Settings.",
      href: `${agentHref}?tab=prompt`,
      cta: "Tilpas agent",
      done: hasConfiguredPrompt,
      trackable: true,
    },
    {
      title: "3. Få et telefonnummer",
      description: "Køb et dansk nummer gennem os, eller importér jeres eget Twilio-nummer.",
      href: "/dashboard/inbound",
      cta: hasPhoneNumber ? "Se numre" : "Få et nummer",
      done: hasPhoneNumber,
      trackable: true,
    },
    {
      title: "4. Viderestil jeres eksisterende nummer",
      description: "Ring en kort kode op fra jeres nuværende mobil/fastnet, så opkald går videre til agenten.",
      href: "/dashboard/inbound",
      cta: "Se koder",
      done: hasPhoneNumber,
      trackable: false,
    },
    {
      title: "5. Forbind jeres kalender",
      description: "Google Kalender, Outlook/Microsoft 365 eller Cal.com — så agenten kan se ledige tider.",
      href: "/dashboard/integrations",
      cta: hasCalendar ? "Se forbindelser" : "Forbind kalender",
      done: hasCalendar,
      trackable: true,
    },
    {
      title: "6. Hent jeres embed-kode",
      description: "Indsæt widget-koden på jeres hjemmeside, så kunder kan tale med agenten direkte på sitet.",
      href: `${agentHref}?tab=embed`,
      cta: "Hent kode",
      done: embedCodeUnlocked && hasWidget,
      trackable: true,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Kom i gang</h1>
        <p className="mt-1 text-sm text-slate-500">
          Følg trinene herunder for at få jeres AI-agent live — {completedCount} af {steps.length} klaret.
        </p>
        <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="space-y-3">
        {steps.map((step) => (
          <li
            key={step.title}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
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
                <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{step.description}</p>
                {!step.trackable && step.done ? (
                  <p className="mt-1 text-xs font-medium text-amber-600">Husk selv at gennemføre dette trin</p>
                ) : null}
              </div>
            </div>
            <Link
              href={step.href}
              className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {step.cta} →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
