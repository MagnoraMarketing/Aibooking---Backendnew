import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/get-locale";
import { translate } from "@/lib/i18n/dictionaries";
import { MARKETING_SITE_URL } from "@/lib/seo/marketing-site";

export default function HomePage() {
  const locale = getRequestLocale();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>
        <a href={MARKETING_SITE_URL} style={{ color: "inherit", textDecoration: "none" }}>
          AIbooking.dk
        </a>
      </h1>
      <p>
        <a href={MARKETING_SITE_URL} style={{ color: "#3866f5", fontWeight: 600 }}>
          {translate(locale, "dashboardPages.home.marketingSiteLink")}
        </a>
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
