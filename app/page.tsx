import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/get-locale";
import { translate } from "@/lib/i18n/dictionaries";

export default function HomePage() {
  const locale = getRequestLocale();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>AIbooking.dk</h1>
      <p>Multi-tenant SaaS backend for AI voice widgets.</p>
      <p>
        This deployment exposes the platform API (see <code>/api/*</code>) and the embeddable widget loader at{" "}
        <code>/widget.js</code>.
      </p>
      <p>
        <Link href="/login" style={{ color: "#3866f5", fontWeight: 600 }}>
          {translate(locale, "dashboardPages.home.loginLink")}
        </Link>
        {" · "}
        <Link href="/signup" style={{ color: "#3866f5", fontWeight: 600 }}>
          {translate(locale, "dashboardPages.home.signupLink")}
        </Link>
      </p>
    </main>
  );
}
