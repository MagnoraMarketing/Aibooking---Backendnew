// Next.js only inlines NEXT_PUBLIC_* variables into the browser bundle when
// it can statically see the literal `process.env.NEXT_PUBLIC_X` expression
// at build time — a dynamic `process.env[name]` lookup (which worked fine
// server-side, where the real process.env is available at runtime) can't be
// substituted, so it silently evaluates to undefined in the browser. That's
// why lib/database/server.ts (server-side) worked while lib/database/browser.ts
// (client-side, e.g. the login page) always failed with "missing env var"
// regardless of what was actually configured. Each getter below must keep
// its `process.env.NEXT_PUBLIC_...` access written out literally.
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const supabaseEnv = {
  get url() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get anonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
};
