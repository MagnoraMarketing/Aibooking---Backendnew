import "server-only";
import { createServerClient, type CookieOptionsWithName } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptionsWithName;
}

// Request-scoped client bound to the caller's auth cookies. Respects RLS,
// so this is what customer-facing (and even admin-facing) route handlers
// should use whenever the operation should be constrained by the signed-in
// user's own permissions rather than blanket service-role access.
export function getServerClient() {
  const cookieStore = cookies();

  return createServerClient(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll called from a Server Component render — safe to ignore
          // because middleware refreshes the session cookie separately.
        }
      },
    },
  });
}
