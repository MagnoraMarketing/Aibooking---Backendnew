import { getPublicAppUrl } from "@/lib/app-url";

// Share links and the embed snippet both point at the platform's own public
// base URL — see lib/app-url.ts for why that isn't just NEXT_PUBLIC_APP_URL.
// These two are the longest-lived URLs the product produces: the share link
// goes in an email, the snippet goes onto a customer's website and is never
// revisited. So they are exactly the ones that must not be built from a
// per-deployment address.
const getAppUrl = getPublicAppUrl;

export function buildShareUrl(publicId: string): string {
  return `${getAppUrl()}/widget/${publicId}`;
}

export function buildEmbedSnippet(publicId: string): string {
  const appUrl = getAppUrl();
  return `<script src="${appUrl}/widget.js" data-widget-id="${publicId}"></script>`;
}
