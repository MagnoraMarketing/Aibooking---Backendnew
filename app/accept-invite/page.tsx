import { getRequestLocale } from "@/lib/i18n/get-locale";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export default function AcceptInvitePage() {
  const locale = getRequestLocale();

  return (
    <LanguageProvider initialLocale={locale}>
      <AcceptInviteForm />
    </LanguageProvider>
  );
}
