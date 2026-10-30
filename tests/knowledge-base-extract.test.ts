import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractTextFromPdf } from "@/lib/knowledge-base/pdf";
import { extractTextFromUrl, stripHtml } from "@/lib/knowledge-base/url";

// What a customer actually uploads or pastes into an agent's knowledge base
// has to come out as clean text: that text is joined onto the agent's
// prompt (lib/knowledge-base/format.ts) and is all it knows about the
// business.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  }) as typeof fetch;
  return calls;
}

const html = (body: string, contentType = "text/html; charset=utf-8") =>
  new Response(body, { status: 200, headers: { "content-type": contentType } });

describe("extractTextFromPdf", () => {
  it("reads every page of a PDF, Danish letters included", async () => {
    const text = await extractTextFromPdf(fs.readFileSync(path.join(__dirname, "fixtures/salon-prisliste.pdf")));
    expect(text).toContain("Børneklip (under 12 år): 250 kr.");
    expect(text).toContain("Åbningstider: mandag–fredag 9–18");
    // Second page.
    expect(text).toContain("Parkering i gården bag salonen.");
  });
});

describe("extractTextFromUrl", () => {
  it("follows redirects, so a bare domain that goes to www still imports", async () => {
    const calls = mockFetch({
      "https://salon.dk/": () => new Response(null, { status: 301, headers: { location: "https://www.salon.dk/" } }),
      "https://www.salon.dk/": () => html("<h1>Velkommen</h1><p>Dameklip 495 kr.</p>"),
    });
    await expect(extractTextFromUrl("https://salon.dk/")).resolves.toBe("Velkommen Dameklip 495 kr.");
    expect(calls).toEqual(["https://salon.dk/", "https://www.salon.dk/"]);
  });

  it("resolves a relative Location header", async () => {
    mockFetch({
      "https://salon.dk/priser": () => new Response(null, { status: 308, headers: { location: "/priser/" } }),
      "https://salon.dk/priser/": () => html("<p>Priser</p>"),
    });
    await expect(extractTextFromUrl("https://salon.dk/priser")).resolves.toBe("Priser");
  });

  it("refuses a redirect to a private address", async () => {
    mockFetch({
      "https://salon.dk/": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    });
    await expect(extractTextFromUrl("https://salon.dk/")).rejects.toThrow(/private\/internal/);
  });

  it("gives up after too many redirects", async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) {
      routes[`https://salon.dk/${i}`] = () =>
        new Response(null, { status: 302, headers: { location: `https://salon.dk/${i + 1}` } });
    }
    mockFetch(routes);
    await expect(extractTextFromUrl("https://salon.dk/0")).rejects.toThrow(/too many times/);
  });

  it("decodes pages served as ISO-8859-1", async () => {
    const latin1 = Buffer.from("<p>Børneklip og åbningstider</p>", "latin1");
    mockFetch({
      "https://gammel-salon.dk/": () =>
        new Response(latin1, { status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" } }),
    });
    await expect(extractTextFromUrl("https://gammel-salon.dk/")).resolves.toBe("Børneklip og åbningstider");
  });
});

describe("stripHtml", () => {
  it("decodes named and numeric entities instead of leaving them in the prompt", () => {
    expect(stripHtml("<p>S&aring;len &amp; B&oslash;rneklip &#230;ble &#xF8; &mdash; 250&nbsp;kr.</p>")).toBe(
      "Sålen & Børneklip æble ø — 250 kr."
    );
  });

  it("drops scripts, styles, inline SVG and noscript", () => {
    expect(stripHtml("<style>p{}</style><svg><text>logo</text></svg><noscript>x</noscript><p>Hej</p><script>y()</script>")).toBe("Hej");
  });
});
