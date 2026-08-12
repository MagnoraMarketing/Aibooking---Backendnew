import "server-only";
import { getServerClient } from "@/lib/database/server";
import type { Profile } from "@/types/database";

export interface AuthContext {
  userId: string;
  email: string | null;
  profile: Profile;
}

export type AuthResolution =
  | { status: "ok"; context: AuthContext }
  // No valid auth cookie/session at all.
  | { status: "unauthenticated" }
  // A valid session exists but there's no matching profiles row — an
  // account left mid-setup by a failed onboarding/signup. Distinct from
  // "unauthenticated" so page guards can avoid bouncing back to /login,
  // which middleware (checking only for a session, not a profile) would
  // just redirect straight back to /dashboard, looping forever.
  | { status: "no-profile" };

// Resolves the signed-in user (from the request's Supabase auth cookie) and
// their profile row.
export async function resolveAuthContext(): Promise<AuthResolution> {
  const supabase = getServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { status: "unauthenticated" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return { status: "no-profile" };

  return {
    status: "ok",
    context: { userId: user.id, email: user.email ?? null, profile: profile as Profile },
  };
}

// Returns null if there is no valid session (for any reason) — callers
// decide whether that's an error via lib/auth/guards. Page/layout Server
// Components that need to break the login/dashboard redirect loop on a
// missing-profile account should use resolveAuthContext() directly instead.
export async function getAuthContext(): Promise<AuthContext | null> {
  const resolution = await resolveAuthContext();
  return resolution.status === "ok" ? resolution.context : null;
}
