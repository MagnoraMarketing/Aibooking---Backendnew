import Link from "next/link";
import { requireMasterAdminForPage } from "@/lib/auth";
import { translate } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

interface IntegrationRow {
  name: string;
  configured: boolean;
  descriptionKey: string;
  href?: string;
}

// Platform-wide integrations only (Vapi, Twilio, Stripe, Supabase) — Cal.com
// and Shopify are connected per-customer (see calcom_connections /
// shopify_connections), so those are linked from the customer detail page
// instead of shown as a single platform-wide status here.
function getIntegrations(): IntegrationRow[] {
  return [
    {
      name: "Vapi (Wapi)",
      configured: Boolean(process.env.VAPI_PRIVATE_KEY && process.env.VAPI_PUBLIC_KEY),
      descriptionKey: "adminPages.integrations.vapiDescription",
      href: "/admin/wapi-agents",
    },
    {
      name: "Twilio",
      configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      descriptionKey: "adminPages.integrations.twilioDescription",
      href: "/admin/phone-numbers",
    },
    {
      name: "Stripe",
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
      descriptionKey: "adminPages.integrations.stripeDescription",
      href: "/admin/settings",
    },
    {
      name: "Supabase",
      configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      descriptionKey: "adminPages.integrations.supabaseDescription",
    },
    {
      name: "Resend (email)",
      configured: Boolean(process.env.RESEND_API_KEY),
      descriptionKey: "adminPages.integrations.resendDescription",
    },
  ];
}

export default async function AdminIntegrationsPage() {
  const ctx = await requireMasterAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
  const integrations = getIntegrations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{translate(locale, "adminShell.nav.integrations")}</h1>
        <p className="mt-1 text-sm text-slate-500">{translate(locale, "adminPages.integrations.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {integrations.map((integration) => (
          <div key={integration.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">{integration.name}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  integration.configured ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                {integration.configured
                  ? translate(locale, "adminPages.overview.statusOk")
                  : translate(locale, "adminPages.overview.statusMissing")}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{translate(locale, integration.descriptionKey)}</p>
            {integration.href ? (
              <Link href={integration.href} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
                {translate(locale, "adminPages.integrations.manage")} →
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">{translate(locale, "adminPages.integrations.perCustomerTitle")}</h2>
        <p className="mt-2 text-sm text-slate-500">{translate(locale, "adminPages.integrations.perCustomerDescription")}</p>
        <Link href="/admin/customers" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
          {translate(locale, "adminShell.nav.customers")} →
        </Link>
      </div>
    </div>
  );
}
