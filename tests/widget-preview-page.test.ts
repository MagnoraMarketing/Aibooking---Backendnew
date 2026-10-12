import { describe, it, expect, vi, beforeEach } from "vitest";

// The Test Agent preview used to be an iframe srcdoc. A srcdoc document's URL
// is `about:srcdoc`, which has no origin, so the widget's realtime stack
// (Vapi -> Daily) ended up calling postMessage with the literal string "null"
// and throwing — a dead microphone button with an error under it. These pin
// the properties that make the replacement a real page instead.

let bundle: unknown;

vi.mock("@/lib/widgets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/widgets")>("@/lib/widgets");
  return { ...actual, getWidgetBundleByPublicId: async () => bundle };
});

vi.mock("@/lib/i18n/get-locale", () => ({ getRequestLocale: () => "da" }));

import { GET } from "@/app/widget/[publicId]/preview/route";

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    widget: {
      public_id: "pub_123",
      name: "Reception",
      business_name: "Bageren ApS",
      welcome_message: "Velkommen!",
      opening_message: "Hej!",
      language: "da",
      primary_color: "#264ed1",
      secondary_color: "#0f172a",
      logo_url: null,
      avatar_url: null,
      position: "bottom-right",
      widget_size: "medium",
      show_branding: true,
      ...overrides,
    },
    llmModel: { provider: "vapi" },
  };
}

async function fetchPreview(origin = "https://app.aibooking.dk") {
  const res = await GET(new Request(`${origin}/widget/pub_123/preview`), { params: { publicId: "pub_123" } });
  return { res, html: await res.text() };
}

describe("the Test Agent preview page", () => {
  beforeEach(() => {
    bundle = makeBundle();
  });

  it("is served as a real HTML document, not embedded markup", async () => {
    const { res, html } = await fetchPreview();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("loads widget.js from the host actually serving the page", async () => {
    const { html } = await fetchPreview("https://aibooking-backendnew.vercel.app");

    // Not NEXT_PUBLIC_APP_URL, which can be unset or stale — a widget.js the
    // browser cannot reach leaves the preview silently empty.
    expect(html).toContain('src="https://aibooking-backendnew.vercel.app/widget.js"');
    expect(html).toContain('data-widget-id="pub_123"');
  });

  it("is never cached, so a saved edit shows up on the next look", async () => {
    const { res } = await fetchPreview();
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("refuses to be framed by anyone but us", async () => {
    const { res } = await fetchPreview();
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("shows the business as the customer configured it", async () => {
    const { html } = await fetchPreview();

    expect(html).toContain("Bageren ApS");
    expect(html).toContain("Velkommen!");
    expect(html).toContain("#264ed1");
  });

  it("escapes widget-controlled text — this page runs on our own origin now", async () => {
    bundle = makeBundle({ business_name: '<script>alert("xss")</script>' });

    const { html } = await fetchPreview();

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to the agent's name when no business name is set", async () => {
    bundle = makeBundle({ business_name: null });

    const { html } = await fetchPreview();

    expect(html).toContain("Reception");
  });
});
