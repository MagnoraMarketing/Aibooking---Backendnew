import "server-only";
import { redirect } from "next/navigation";
import { resolveAuthContext } from "./session";
import type { AuthContext } from "./session";

// Page/layout Server Components can't handle a thrown ApiError the way API
// route handlers do (there's no wrapper turning it into a JSON response) —
// an uncaught throw there renders Next.js's generic "server-side exception"
// crash page instead of sending the visitor somewhere useful. These wrap
// resolveAuthContext() for use directly inside page.tsx/layout.tsx files.
//
// Unauthenticated (no session) goes to /login, same as before. A session
// that exists but has no matching profiles row goes to /account-incomplete
// instead — NOT /login — because middleware only checks for a session, so
// sending a would-be-authenticated-but-broken account to /login just gets
// it bounced straight back to /dashboard by middleware, looping forever.
export async function requireAuthForPage(): Promise<AuthContext> {
  const resolution = await resolveAuthContext();
  if (resolution.status === "ok") return resolution.context;
  if (resolution.status === "no-profile") redirect("/account-incomplete");
  redirect("/login");
}

export async function requireCustomerAdminForPage(): Promise<AuthContext> {
  const ctx = await requireAuthForPage();
  if (ctx.profile.role !== "CUSTOMER_ADMIN" || !ctx.profile.customer_id) {
    redirect("/login");
  }
  return ctx;
}

export async function requireMasterAdminForPage(): Promise<AuthContext> {
  const ctx = await requireAuthForPage();
  if (ctx.profile.role !== "MASTER_ADMIN") {
    redirect("/login");
  }
  return ctx;
}
