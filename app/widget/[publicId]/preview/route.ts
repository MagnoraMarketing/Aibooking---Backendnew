import { notFound } from "next/navigation";
import { getWidgetBundleByPublicId, toPublicWidgetConfig, buildEmbedSnippet } from "@/lib/widgets";
import { getRequestLocale } from "@/lib/i18n/get-locale";
import { translate } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

// The stand-in "customer homepage" the Test Agent tab frames — a real page at
// a real URL, deliberately NOT an iframe srcdoc.
//
// A srcdoc document's URL is `about:srcdoc`, which has no origin to
// serialize, so anything deriving the page's origin from that URL gets the
// string "null". The widget's realtime stack (Vapi -> Daily) does exactly
// that when it talks to its own call-machine frame, and
// `postMessage(msg, "null")` throws:
//
//   Failed to load call object bundle …: SyntaxError: Failed to execute
//   'postMessage' on 'Window': Invalid target origin 'null'
//
// which surfaced to customers as a dead microphone button with an error
// under it. Serving the same HTML from here gives the frame an ordinary
// https origin, so the call object loads exactly as it does on a real
// customer site — which is what this preview claims to show in the first
// place.
export async function GET(request: Request, { params }: { params: { publicId: string } }) {
  const bundle = await getWidgetBundleByPublicId(params.publicId);
  if (!bundle) notFound();

  const config = toPublicWidgetConfig(bundle);
  const locale = getRequestLocale();
  const t = (key: string) => translate(locale, key);

  // The snippet is quoted verbatim so the preview runs the customer's real
  // embed code — except for the origin, which is pinned to whichever host is
  // serving this page. NEXT_PUBLIC_APP_URL can be unset or stale (see
  // lib/app-url.ts), and a widget.js the browser can't reach would leave the
  // preview silently empty. The Test Agent tab warns about the mismatch
  // separately; this just makes sure the preview itself still works.
  const snippet = buildEmbedSnippet(config.publicId).replace(
    /src="[^"]*\/widget\.js"/,
    `src="${new URL(request.url).origin}/widget.js"`
  );

  const businessName = escapeHtml(config.businessName ?? bundle.widget.name);
  const welcomeMessage = escapeHtml(config.welcomeMessage ?? t("agent.testAgent.defaultWelcomeMessage"));

  const html = `<!doctype html>
<html lang="${escapeHtml(config.language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${businessName}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; color: #0f172a; }
  header { padding: 56px 24px; text-align: center; background: ${escapeHtml(config.secondaryColor)}1a; }
  header h1 { margin: 0 0 8px; font-size: 28px; }
  header p { margin: 0; color: #475569; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px 140px; line-height: 1.6; color: #334155; }
  .placeholder-block { height: 160px; border-radius: 12px; background: #e2e8f0; margin: 24px 0; }
  .try-agent {
    display: inline-block; border: 0; cursor: pointer; border-radius: 10px; padding: 12px 20px;
    font: inherit; font-weight: 600; color: #fff; background: ${escapeHtml(config.primaryColor)};
  }
  .try-agent-hint { margin-top: 8px; font-size: 13px; color: #64748b; }
</style>
</head>
<body>
  <header>
    <h1>${businessName}</h1>
    <p>${welcomeMessage}</p>
  </header>
  <main>
    <h2>${escapeHtml(t("agent.testAgent.previewHeading"))}</h2>
    <p>${escapeHtml(t("agent.testAgent.previewParagraph"))}</p>
    <div class="placeholder-block"></div>
    <button type="button" class="try-agent" onclick="window.aibooking && window.aibooking.open()">
      ${escapeHtml(t("agent.testAgent.previewCtaLabel"))}
    </button>
    <p class="try-agent-hint">${escapeHtml(t("agent.testAgent.previewCtaHint"))}</p>
    <p>${escapeHtml(t("agent.testAgent.previewFooterParagraph"))}</p>
  </main>
  ${snippet}
  <script>
    // Open the agent as soon as widget.js has built it, so the preview shows
    // the actual widget rather than a corner button the customer has to
    // find. window.aibooking only exists once the config fetch has resolved,
    // hence the short poll; it gives up rather than spinning forever if the
    // widget never loads (the Test Agent tab's banner explains that case).
    (function () {
      var tries = 0;
      var timer = setInterval(function () {
        if (window.aibooking) {
          clearInterval(timer);
          window.aibooking.open();
        } else if (++tries > 60) {
          clearInterval(timer);
        }
      }, 100);
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The customer edits the widget and expects the next preview to show
      // it — never let a CDN or the browser hand back the previous version.
      "Cache-Control": "no-store, max-age=0",
      // This page is only ever meant to be framed by our own dashboard.
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}

// Widget-controlled text (business name, welcome message, colours) is
// interpolated into raw HTML here, and unlike the old srcdoc frame this page
// runs on the platform's own origin — so escaping is a real boundary, not a
// tidiness measure.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
