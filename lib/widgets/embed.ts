// NEXT_PUBLIC_APP_URL is the intended source of truth (e.g. a custom
// domain), but it's easy to forget to set on a fresh Vercel deploy — without
// a fallback that silently produces share/embed links pointing at
// http://localhost:3000, which only ever works on the developer's own
// machine (see the "Test Agent" tab, which iframes this URL). Vercel's own
// deployment URL is a working fallback: VERCEL_URL is a request-agnostic
// automatic env var set for every hosted deployment (all environments,
// no dashboard config required) — see
// https://vercel.com/docs/environment-variables/system-environment-variables.
function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function buildShareUrl(publicId: string): string {
  return `${getAppUrl()}/widget/${publicId}`;
}

export function buildEmbedSnippet(publicId: string): string {
  const appUrl = getAppUrl();
  return `<script src="${appUrl}/widget.js" data-widget-id="${publicId}"></script>`;
}
