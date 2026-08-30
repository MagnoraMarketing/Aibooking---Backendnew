"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/database/browser";
import { useTranslation } from "@/components/i18n/language-provider";

export function LogoutButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    const supabase = getBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
    >
      {loading ? t("dashboardShell.loggingOut") : t("dashboardShell.logout")}
    </button>
  );
}
