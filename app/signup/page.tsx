"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getBrowserClient } from "@/lib/database/browser";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState("da");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, email, password, language }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Kunne ikke oprette kontoen. Prøv igen.");
        setLoading(false);
        return;
      }

      const supabase = getBrowserClient();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000)
      );
      const { error: signInError } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeout,
      ]);

      if (signInError) {
        setLoading(false);
        setError("Kontoen blev oprettet, men login fejlede — prøv at logge ind manuelt.");
        router.push("/login");
        return;
      }

      // Hard navigation, not router.push: guarantees the dashboard's
      // server-side auth check sees the just-set session cookie instead of
      // possibly racing ahead of it (see app/login/page.tsx for the same fix).
      window.location.href = "/dashboard";
    } catch (err) {
      setLoading(false);
      if (err instanceof Error && err.message === "timeout") {
        setError("Kontoen blev muligvis oprettet, men login tog for lang tid. Prøv at logge ind manuelt.");
      } else {
        const detail = err instanceof Error ? err.message : "Ukendt fejl";
        setError(`Kontoen blev muligvis oprettet, men noget gik galt: ${detail}`);
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">AIbooking.dk</h1>
        <p className="mt-1 text-sm text-slate-500">Opret jeres konto</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="companyName" className="mb-1 block text-sm font-medium text-slate-700">
              Firmanavn
            </label>
            <input
              id="companyName"
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label htmlFor="language" className="mb-1 block text-sm font-medium text-slate-700">
              Ønsket sprog
            </label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="da">Dansk</option>
              <option value="en">Engelsk</option>
            </select>
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              Adgangskode
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-slate-400">Mindst 8 tegn</p>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Opretter…" : "Opret konto"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Har du allerede en konto?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Log ind
          </Link>
        </p>
      </div>
    </main>
  );
}
