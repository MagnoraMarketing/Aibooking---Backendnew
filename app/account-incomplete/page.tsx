// Deliberately not gated by any auth guard: this is where broken accounts
// (a valid Supabase session but no matching profiles row — an onboarding
// that failed partway through) land. Gating it the normal way would send
// them straight back into the same redirect loop that got them here.
export default function AccountIncompletePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Kontoen er ikke helt oprettet</h1>
        <p className="mt-3 text-sm text-slate-500">
          Der er en konto tilknyttet denne login, men opsætningen blev ikke fuldført. Kontakt os på{" "}
          <a href="mailto:hej@aibooking.dk" className="font-medium text-brand-600 hover:text-brand-700">
            hej@aibooking.dk
          </a>{" "}
          for at få det rettet.
        </p>
      </div>
    </main>
  );
}
