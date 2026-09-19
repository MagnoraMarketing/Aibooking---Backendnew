import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

// A visitor's very first request ever has no NEXT_LOCALE cookie yet.
// response.cookies.set() alone only reaches the browser on the *next*
// request — it can't affect the page already rendering for *this* one — so
// the fix has to land the cookie on request.cookies too, before any
// downstream NextResponse.next({ request }) is built (see middleware.ts).
describe("middleware's locale stamping", () => {
  it("mutates request.cookies synchronously so this exact request's render sees the browser-matched locale", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://aibooking.dk/login", {
      headers: { "accept-language": "en-US,en;q=0.9" },
    });

    expect(request.cookies.get("NEXT_LOCALE")).toBeUndefined();

    await middleware(request);

    expect(request.cookies.get("NEXT_LOCALE")?.value).toBe("en");
  });

  it("also sets the cookie on the response, for the browser's next request", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://aibooking.dk/signup", {
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
    });

    const response = await middleware(request);

    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("fr");
  });

  it("falls back to the platform default for an unsupported browser language", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://aibooking.dk/login", {
      headers: { "accept-language": "ja-JP,ja;q=0.9" },
    });

    await middleware(request);

    expect(request.cookies.get("NEXT_LOCALE")?.value).toBe("da");
  });

  it("leaves an already-chosen locale alone instead of overwriting it from the browser", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("https://aibooking.dk/login", {
      headers: { "accept-language": "da-DK,da;q=0.9" },
      // A previous visit (or an explicit choice in Profile settings, see
      // components/i18n/language-provider.tsx's setLocale) already set this
      // — the browser's current language must not override it.
    });
    request.cookies.set("NEXT_LOCALE", "en");

    const response = await middleware(request);

    expect(request.cookies.get("NEXT_LOCALE")?.value).toBe("en");
    // Nothing to re-stamp on the response either — the cookie already
    // exists in the browser.
    expect(response.cookies.get("NEXT_LOCALE")).toBeUndefined();
  });
});
