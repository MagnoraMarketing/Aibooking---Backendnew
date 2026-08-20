import { requireMasterAdminForPage } from "@/lib/auth";
import { LanguageSettings } from "@/components/profile/language-settings";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { translate } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function AdminProfilePage() {
  const ctx = await requireMasterAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{translate(locale, "profile.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{translate(locale, "profile.subtitle")}</p>
      </div>
      <LanguageSettings currentLanguage={locale} />
    </div>
  );
}
