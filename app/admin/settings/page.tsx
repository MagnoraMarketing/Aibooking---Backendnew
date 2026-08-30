import { requireMasterAdminForPage } from "@/lib/auth";
import {
  getDefaultSystemPrompt,
  getVapiVoiceTemplateAssistantId,
} from "@/lib/settings/platform";
import { VapiVoiceTemplatesSettings } from "@/components/admin/vapi-voice-templates-settings";
import { DefaultPromptSettings } from "@/components/admin/default-prompt-settings";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { translate } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const ctx = await requireMasterAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;

  // Read the settings straight from the database rather than fetching this
  // app's own /api/admin/settings/default-prompt: that route sits behind
  // requireMasterAdmin, and a server-side fetch carries no auth cookies, so
  // it would answer 401 and this page would throw instead of rendering.
  const [maleAssistantId, femaleAssistantId, defaultPrompt] = await Promise.all([
    getVapiVoiceTemplateAssistantId("male"),
    getVapiVoiceTemplateAssistantId("female"),
    getDefaultSystemPrompt(),
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
      <DefaultPromptSettings initialPrompt={defaultPrompt} />
    </div>
  );
}
