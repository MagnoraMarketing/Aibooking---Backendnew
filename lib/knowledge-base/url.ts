import "server-only";
import { assertSafeHttpUrl } from "@/lib/security/ssrf";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB — plenty for a few pages of HTML
const FETCH_TIMEOUT_MS = 10_000;

// Named entities that actually turn up in Danish (and other European)
// pages. Anything else named is left as-is rather than guessed at; numeric
// entities (&#230; / &#xE6;) are decoded generically below.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", aring: "å", Aring: "Å",
  auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", szlig: "ß",
  eacute: "é", Eacute: "É", egrave: "è", ecirc: "ê", agrave: "à", aacute: "á",
  ccedil: "ç", ntilde: "ñ", oacute: "ó", iacute: "í", uacute: "ú", atilde: "ã", otilde: "õ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", bull: "•", middot: "·", euro: "€", copy: "©", reg: "®", trade: "™", deg: "°",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

// Exported for the Shopify crawler (lib/shopify/crawl.ts), which reads the
// same kind of storefront HTML and wants the same plain-text out.
export function stripHtml(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

const MAX_REDIRECTS = 5;

// Charset from the Content-Type header, else from a <meta charset> in the
// first bytes; older Danish sites still serve ISO-8859-1, which decoded as
// UTF-8 would garble every æ, ø and å.
function detectCharset(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const sniff = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8";
}

function decodeBody(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder(detectCharset(contentType, bytes)).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export async function extractTextFromUrl(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  assertSafeHttpUrl(url);

  // Redirects are followed by hand so every hop gets the same SSRF check as
  // the URL the customer typed — almost every site redirects somewhere
  // (https://salon.dk -> https://www.salon.dk/), so refusing them made the
  // import fail for most people pasting their own homepage.
  let current = url;
  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "AIbookingKnowledgeBaseBot/1.0", Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Failed to fetch URL: ${response.status}`);
    if (hop === MAX_REDIRECTS) throw new Error("This URL redirects too many times");
    current = new URL(location, current);
    assertSafeHttpUrl(current);
  }
  if (!response) throw new Error("Failed to fetch URL");

  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml\+xml/.test(contentType)) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Page is too large to import");
  }

  return stripHtml(decodeBody(buffer, contentType));
}
