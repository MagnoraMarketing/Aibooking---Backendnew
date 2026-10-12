import Link from "next/link";
import { translate } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

// "Jeres forbindelser": one row per agent with every integration grouped
// where it is set up — Kalender (Cal.com/Google/Outlook), Webshop (Shopify)
// and Levering (Uber Direct/Just Eat) — so the customer sees at a glance what
// each agent can do and lands on the right tab to change it.

export interface IntegrationsOverviewRow {
  widgetId: string;
  name: string;
  calendars: string[];
  shopify: "connected" | "needs_reauth" | null;
  uber: boolean;
  justEat: boolean;
}

const PROVIDER_LABEL: Record<string, string> = { calcom: "Cal.com", google: "Google Kalender", outlook: "Outlook" };

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        on ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {children}
    </span>
  );
}

function Cell({ href, children, setUp }: { href: string; children: React.ReactNode; setUp: string }) {
  return (
    <td className="px-4 py-3 align-top">
      <div className="flex flex-wrap gap-1">{children}</div>
      <Link href={href} className="mt-1 inline-block text-xs font-medium text-brand-600 hover:text-brand-700">
        {setUp}
      </Link>
    </td>
  );
}

export function IntegrationsOverview({ rows, locale }: { rows: IntegrationsOverviewRow[]; locale: Locale }) {
  const t = (key: string) => translate(locale, key);
  if (rows.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">{t("dashboardPages.integrations-overview.title")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("dashboardPages.integrations-overview.subtitle")}</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("dashboardPages.integrations-overview.agent")}</th>
              <th className="px-4 py-3">{t("dashboardPages.integrations-overview.calendar")}</th>
              <th className="px-4 py-3">{t("dashboardPages.integrations-overview.webshop")}</th>
              <th className="px-4 py-3">{t("dashboardPages.integrations-overview.delivery")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const base = `/dashboard/agent/${row.widgetId}`;
              const setUp = t("dashboardPages.integrations-overview.manage");
              const none = t("dashboardPages.integrations-overview.none");
              return (
                <tr key={row.widgetId}>
                  <td className="px-4 py-3 align-top font-medium text-slate-900">{row.name}</td>
                  <Cell href={`${base}?tab=booking`} setUp={setUp}>
                    {row.calendars.length > 0 ? (
                      row.calendars.map((provider) => (
                        <Chip key={provider} on>
                          {PROVIDER_LABEL[provider] ?? provider}
                        </Chip>
                      ))
                    ) : (
                      <Chip on={false}>{none}</Chip>
                    )}
                  </Cell>
                  <Cell href={`${base}?tab=webshop`} setUp={setUp}>
                    {row.shopify === "connected" ? (
                      <Chip on>Shopify</Chip>
                    ) : row.shopify === "needs_reauth" ? (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Shopify · {t("dashboardPages.integrations-overview.reconnect")}
                      </span>
                    ) : (
                      <Chip on={false}>{none}</Chip>
                    )}
                  </Cell>
                  <Cell href={`${base}?tab=delivery`} setUp={setUp}>
                    {row.uber ? <Chip on>Uber Direct</Chip> : null}
                    {row.justEat ? <Chip on>Just Eat</Chip> : null}
                    {!row.uber && !row.justEat ? <Chip on={false}>{none}</Chip> : null}
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
