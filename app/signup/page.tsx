import { getRequestLocale } from "@/lib/i18n/get-locale";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  const locale = getRequestLocale();

  return (
    <LanguageProvider initialLocale={locale}>
      <SignupForm initialLanguage={locale} />
    </LanguageProvider>
  );
}
