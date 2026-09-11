import { resolveAppUrl } from "@/lib/app-url";

// Both of these are handed out to live on: the share link goes in an email,
// the embed snippet goes onto a customer's website and is never revisited.
// So they are exactly the URLs that must not be built from a per-deployment
// address — see lib/app-url.ts for the fallback order that guarantees it.

export function buildShareUrl(publicId: string): string {
  return `${resolveAppUrl()}/widget/${publicId}`;
}

export function buildEmbedSnippet(publicId: string): string {
  const appUrl = resolveAppUrl();
  return `<script src="${appUrl}/widget.js" data-widget-id="${publicId}"></script>`;
}
