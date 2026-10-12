// The platform's own public base URL — the one we hand to *other people's*
// systems: Stripe's success/cancel redirects, Vapi's serverUrl for call
// events and booking tools, the embed snippet a customer pastes on their
// site, invitation links in email.
//
// NEXT_PUBLIC_APP_URL is the intended source of truth (a custom domain), but
// it's easy to forget on a fresh Vercel deploy — and each caller used to
// carry its own `?? "http://localhost:3000"`, which turns a missing env var
// into a working-looking URL that is useless to everyone except the
// developer who wrote it: a Stripe checkout that redirects the paying
// customer to localhost, a Vapi assistant whose webhook never arrives.
//
// The two Vercel fallbacks are automatic system env vars, set on every
// hosted deployment with no dashboard config, and the order between them is
// the whole point:
//
//   VERCEL_PROJECT_PRODUCTION_URL — the project's production domain. The
//     same value for every deployment, so an embed snippet built from it is
//     still resolving a month and ten deploys later.
//
//   VERCEL_URL — *this deployment's own* URL, different for every single
//     deploy. Anything long-lived built from it breaks the next time you
//     ship, out on the customer's website where nobody is watching. Last
//     resort before localhost.
//
// https://vercel.com/docs/environment-variables/system-environment-variables
//
// Not used by lib/telephony/urls.ts: Twilio signs the exact URL string it
// was configured with, so that module keeps its own stricter resolution —
// NEXT_PUBLIC_APP_URL or the production domain, never the per-deployment
// VERCEL_URL — and fails loudly rather than falling back further.
function normalize(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "");
}

export function getPublicAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return normalize(process.env.NEXT_PUBLIC_APP_URL);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL)}`;
  }
  if (process.env.VERCEL_URL) return `https://${normalize(process.env.VERCEL_URL)}`;
  return "http://localhost:3000";
}

// True when the resolved URL is something the outside world can actually
// reach. Callers that hand the URL to a third party use this to skip or warn
// rather than registering a localhost address that silently never works.
export function isPubliclyReachableAppUrl(): boolean {
  const url = getPublicAppUrl();
  return /^https:\/\//i.test(url) && !/^https:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url);
}

// Stricter than reachable, and a different question: is this an address a
// customer can be given *for keeps*? A per-deployment VERCEL_URL is
// reachable today and dead after the next deploy, which is exactly what
// makes it worth telling them apart.
export function isStableAppUrl(): boolean {
  if (process.env.NEXT_PUBLIC_APP_URL) return true;
  return Boolean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
}
