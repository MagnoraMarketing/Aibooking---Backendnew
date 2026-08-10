import "server-only";
import { getServerClient } from "@/lib/database/server";
import type { Profile } from "@/types/database";

export interface AuthContext {
  userId: string;
  email: string | null;
  profile: Profile;
}

// Resolves the signed-in user (from the request's Supabase auth cookie) and
// their profile row. Returns null if there is no valid session — callers
// decide whether that's an error via lib/auth/guards.
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = getServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return null;

  return { userId: user.id, email: user.email ?? null, profile: profile as Profile };
}
