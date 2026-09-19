import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { Header } from "@/components/dashboard/header";
import { TrialEndedBanner } from "@/components/dashboard/trial-ended-banner";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { translate } from "@/lib/i18n/dictionaries";
import { hasEmbedCodeAccess } from "@/lib/billing";
import type { Customer, Subscription } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuthForPage();

  if (ctx.profile.role === "MASTER_ADMIN") {
    redirect("/admin");
  }

  if (ctx.profile.role !== "CUSTOMER_ADMIN" || !ctx.profile.customer_id) {
    redirect("/login");
  }

  const supabase = getAdminClient();
  const [{ data: customer }, { data: creditAccount }, { data: subscription }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", ctx.profile.customer_id).single<Customer>(),
    supabase
      .from("credit_accounts")
      .select("balance_seconds")
      .eq("customer_id", ctx.profile.customer_id)
      .maybeSingle<{ balance_seconds: number }>(),
    supabase
      .from("subscriptions")
      .select("status")
      .eq("customer_id", ctx.profile.customer_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Pick<Subscription, "status">>(),
  ]);

  const balanceSeconds = creditAccount?.balance_seconds ?? 0;
  const minutesRemaining = Math.round((balanceSeconds / 60) * 100) / 100;
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
  const userLabel = ctx.profile.full_name || ctx.email || translate(locale, "dashboardShell.defaultUserLabel");

  // Same access check that gates the embed code (lib/billing/trial.ts) —
  // once it's false, the customer's free trial (days or minutes,
  // whichever ran out first) is over and they haven't converted to a paid
  // package or the one-off Voice Widget launch offer. Building and testing
  // an agent stays free indefinitely; this only nudges toward paying for
  // what actually needs it (going live, making real calls).
  const trialEnded = customer
    ? !hasEmbedCodeAccess({
        customerCreatedAt: customer.created_at,
        subscriptionStatus: subscription?.status ?? null,
        balanceSeconds,
        widgetLaunchPaidAt: customer.widget_launch_paid_at,
      })
    : false;

  return (
    <LanguageProvider initialLocale={locale}>
      <div className="min-h-screen bg-slate-50">
        <Header
          customerName={customer?.name ?? "AIbooking.dk"}
          userLabel={userLabel}
          minutesRemaining={minutesRemaining}
        />
        {trialEnded ? <TrialEndedBanner /> : null}
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </LanguageProvider>
  );
}
