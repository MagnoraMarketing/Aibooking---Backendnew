import { DashboardPlaceholder } from "@/components/dashboard/placeholder";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { translate } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const ctx = await requireCustomerAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;

  return (
    <DashboardPlaceholder
      title={translate(locale, "dashboardShell.nav.analytics")}
      description={translate(locale, "dashboardPages.analytics.description")}
      comingSoonLabel={translate(locale, "dashboardPages.shared.comingSoon")}
    />
  );
}
