import { redirect } from "next/navigation";
import { getRequestLocale } from "@/lib/i18n/get-locale";
import { resolveAuthContext } from "@/lib/auth/session";
import { getServerClient } from "@/lib/database/server";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { CompleteSignupForm } from "@/components/auth/complete-signup-form";

export const dynamic = "force-dynamic";

// Deliberately not gated by the normal auth guard: this is where a login
// without an AIbooking account lands (gating it the normal way would loop).
// The auth project is shared with Nordcall, so that is usually someone who
// signed up for Nordcall first. The two products keep separate accounts, so
// they create their own AIbooking account here instead of hitting a dead end.
export default async function AccountIncompletePage() {
  const resolution = await resolveAuthContext();
  if (resolution.status === "ok") redirect("/dashboard");

  const {
    data: { user },
  } = await getServerClient().auth.getUser();
  if (!user?.email) redirect("/login");

  const locale = getRequestLocale();
  return (
    <LanguageProvider initialLocale={locale}>
      <CompleteSignupForm email={user.email} initialLanguage={locale} />
    </LanguageProvider>
  );
}
