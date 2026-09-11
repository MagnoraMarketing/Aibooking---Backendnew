// Every absolute URL this platform hands to the outside world starts here —
// a customer's embed snippet, a Stripe return URL, an OAuth redirect_uri, an
// invite link, the serverUrl a Vapi assistant posts call events back to.
// They must all agree on what "our address" is, so there is one resolver
// rather than a copy of the same `?? "http://localhost:3000"` in each module.
//
// NEXT_PUBLIC_APP_URL is the intended source of truth: the real domain, set
// once per environment. The fallbacks exist so a fresh deploy isn't
// completely dead, but they are strictly worse, and ordered accordingly:
//
//   VERCEL_PROJECT_PRODUCTION_URL — the project's stable production domain
//     (e.g. aibooking-backendnew.vercel.app). The same value for every
//     deployment, so a snippet built from it still works after the next
//     deploy.
//
//   VERCEL_URL — *this deployment's own* URL
//     (e.g. aibooking-backendnew-jwlxrkawl-….vercel.app). It is different
//     for every single deploy, which makes it actively dangerous for
//     anything long-lived: an embed snippet pasted onto a customer's website
//     stops resolving the next time you ship. Last resort before localhost,
//     and it is why the order above matters.
//
// Both Vercel values are system environment variables, present automatically
// in every hosted deployment with no dashboard configuration:
// https://vercel.com/docs/environment-variables/system-environment-variables

// A trailing slash would produce "…dk//api/…" downstream — harmless-looking,
// but an OAuth redirect_uri or a Twilio-signed webhook URL has to match
// byte-for-byte, so normalise once here instead of at each call site.
function normalize(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "");
}

const LOCAL_FALLBACK = "http://localhost:3000";

export interface AppUrlResolution {
  url: string;
  // Which variable answered. Callers that must not hand out an unstable or
  // unreachable address (see resolvePublicAppUrl) branch on this rather than
  // re-reading the environment themselves.
  source: "configured" | "vercel-production" | "vercel-deployment" | "local-fallback";
}

export function resolveAppUrlWithSource(): AppUrlResolution {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return { url: normalize(configured), source: "configured" };

  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionDomain) return { url: `https://${normalize(productionDomain)}`, source: "vercel-production" };

  const deploymentDomain = process.env.VERCEL_URL;
  if (deploymentDomain) return { url: `https://${normalize(deploymentDomain)}`, source: "vercel-deployment" };

  return { url: LOCAL_FALLBACK, source: "local-fallback" };
}

export function resolveAppUrl(): string {
  return resolveAppUrlWithSource().url;
}

// For URLs that a third party will call back on, or that a customer will
// keep: Twilio, Vapi, Stripe, Google/Microsoft OAuth. localhost is useless to
// all of them — a serverUrl pointing at it means call events are simply never
// delivered — so this returns null instead of a value that looks fine and
// silently does nothing. Callers decide whether that's fatal or just skipped.
export function resolvePublicAppUrl(): string | null {
  const { url, source } = resolveAppUrlWithSource();
  return source === "local-fallback" ? null : url;
}

// Whether the resolved address is one a customer can safely be given for
// keeps. A per-deployment Vercel URL resolves and even works today, which is
// exactly what makes it worth flagging: it breaks on the next deploy, long
// after whoever pasted it has stopped looking.
export function isStableAppUrl(): boolean {
  const { source } = resolveAppUrlWithSource();
  return source === "configured" || source === "vercel-production";
}
