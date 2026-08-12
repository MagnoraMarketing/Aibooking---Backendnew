import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isLoginRoute = pathname === "/login";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[middleware] Missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY — skipping auth check");
    return NextResponse.next();
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

    if (isDashboardRoute && !user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    if (isLoginRoute && user) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
  } catch (err) {
    console.error("[middleware] Supabase auth check failed:", err);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
