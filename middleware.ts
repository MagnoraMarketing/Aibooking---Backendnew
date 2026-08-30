import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, matchLocale } from "@/lib/i18n/locales";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptionsWithName;
}

// Refreshes the Supabase auth cookie on every request and gates /dashboard
// behind a signed-in session. Runs in the Edge runtime, so it must use the
// anon-key client (never the service role key) — same as lib/database/server.ts,
// just adapted to NextRequest/NextResponse cookies instead of next/headers.
//
// Deliberately fails open (lets the request through) rather than crashing
// the whole site if Supabase is unreachable or misconfigured — the actual
// dashboard pages independently enforce auth server-side via requireAuth()
// (see app/dashboard/layout.tsx), so this is a UX nicety on top of that,
// not the only line of defense.
// Stamps NEXT_LOCALE from Accept-Language on a visitor's very first request
// (signup/login, pre-auth — see lib/i18n/get-locale.ts) so the first
// server-rendered page already matches their browser instead of flashing
// Danish. A no-op once the cookie exists — a signed-in user's
// profile.language (set explicitly, possibly overriding this guess) always
// takes precedence wherever it's read.
function stampLocaleCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.get(LOCALE_COOKIE)) return response;
  const locale = matchLocale(request.headers.get("accept-language"));
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
  const isLoginRoute = pathname === "/login" || pathname === "/signup";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[middleware] Missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY — skipping auth check");
    return stampLocaleCookie(request, NextResponse.next());
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (isProtectedRoute && !user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return stampLocaleCookie(request, NextResponse.redirect(url));
    }

    if (isLoginRoute && user) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return stampLocaleCookie(request, NextResponse.redirect(url));
    }
  } catch (err) {
    console.error("[middleware] Supabase auth check failed:", err);
  }

  return stampLocaleCookie(request, response);
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/signup"],
};
