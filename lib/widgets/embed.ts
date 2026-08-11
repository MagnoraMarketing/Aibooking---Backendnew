function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function buildShareUrl(publicId: string): string {
  return `${getAppUrl()}/widget/${publicId}`;
}

export function buildEmbedSnippet(publicId: string): string {
  const appUrl = getAppUrl();
  return `<script src="${appUrl}/widget.js" data-widget-id="${publicId}"></script>`;
}
