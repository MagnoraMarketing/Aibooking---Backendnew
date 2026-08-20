import { requireMasterAdminForPage } from "@/lib/auth";
import { getVapiVoiceTemplateAssistantId } from "@/lib/settings/platform";
import { VapiVoiceTemplatesSettings } from "@/components/admin/vapi-voice-templates-settings";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { translate } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const ctx = await requireMasterAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;

  const [maleAssistantId, femaleAssistantId] = await Promise.all([
    getVapiVoiceTemplateAssistantId("male"),
    getVapiVoiceTemplateAssistantId("female"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{translate(locale, "adminShell.nav.settings")}</h1>
        <p className="mt-1 text-sm text-slate-500">{translate(locale, "adminPages.settings.subtitle")}</p>
      </div>
      <VapiVoiceTemplatesSettings
        initialMaleAssistantId={maleAssistantId}
        initialFemaleAssistantId={femaleAssistantId}
      />
    </div>
  );
}
