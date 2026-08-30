import { getRequestLocale } from "@/lib/i18n/get-locale";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  const locale = getRequestLocale();

  return (
    <LanguageProvider initialLocale={locale}>
      <LoginForm />
    </LanguageProvider>
  );
}
