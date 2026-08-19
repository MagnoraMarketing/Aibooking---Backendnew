import { requireMasterAdminForPage } from "@/lib/auth";
import { getVapiVoiceTemplateAssistantId } from "@/lib/settings/platform";
import { VapiVoiceTemplatesSettings } from "@/components/admin/vapi-voice-templates-settings";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireMasterAdminForPage();

  const [maleAssistantId, femaleAssistantId] = await Promise.all([
    getVapiVoiceTemplateAssistantId("male"),
    getVapiVoiceTemplateAssistantId("female"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Indstillinger</h1>
        <p className="mt-1 text-sm text-slate-500">Platform-wide opsætning.</p>
      </div>
      <VapiVoiceTemplatesSettings
        initialMaleAssistantId={maleAssistantId}
        initialFemaleAssistantId={femaleAssistantId}
      />
    </div>
  );
}
