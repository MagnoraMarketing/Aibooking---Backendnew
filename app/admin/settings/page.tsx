import { Suspense } from "react";
import { requireMasterAdminForPage } from "@/lib/auth";
import { DefaultPromptSettings } from "@/components/admin/default-prompt-settings";

export const dynamic = "force-dynamic";

async function fetchDefaultPrompt(): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/admin/settings/default-prompt`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Kunne ikke hente standard prompt");
  const data = (await res.json()) as { prompt: string };
  return data.prompt;
}

export default async function AdminSettingsPage() {
  await requireMasterAdminForPage();
  const prompt = await fetchDefaultPrompt();

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Admin Settings</h1>
        <p className="text-gray-600 mt-2">Administrer platform-brede indstillinger</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">System Prompts</h2>
        <Suspense fallback={<div>Indlæser...</div>}>
          <DefaultPromptSettings initialPrompt={prompt} />
        </Suspense>
      </div>
    </div>
  );
}
