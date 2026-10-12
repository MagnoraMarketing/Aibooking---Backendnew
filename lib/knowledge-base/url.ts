import "server-only";
import { assertSafeHttpUrl } from "@/lib/security/ssrf";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB — plenty for a few pages of HTML
const FETCH_TIMEOUT_MS = 10_000;

// Exported for the Shopify crawler (lib/shopify/crawl.ts), which reads the
// same kind of storefront HTML and wants the same plain-text out.
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractTextFromUrl(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  assertSafeHttpUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      // Don't chase redirects blindly — a customer-supplied URL could
      // redirect somewhere private. Require the direct URL instead.
      redirect: "manual",
      headers: { "User-Agent": "AIbookingKnowledgeBaseBot/1.0" },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new Error("This URL redirects — please provide the direct destination URL instead");
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Page is too large to import");
  }

  const html = new TextDecoder().decode(buffer);
  return stripHtml(html);
}
