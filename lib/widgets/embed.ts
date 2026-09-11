import { getPublicAppUrl } from "@/lib/app-url";

// Share links and the embed snippet both point at the platform's own public
// base URL — see lib/app-url.ts for why that isn't just NEXT_PUBLIC_APP_URL.
const getAppUrl = getPublicAppUrl;

export function buildShareUrl(publicId: string): string {
  return `${getAppUrl()}/widget/${publicId}`;
}

export function buildEmbedSnippet(publicId: string): string {
  const appUrl = getAppUrl();
  return `<script src="${appUrl}/widget.js" data-widget-id="${publicId}"></script>`;
}
