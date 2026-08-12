import "server-only";
import { redirect } from "next/navigation";
import { requireAuth, requireCustomerAdmin, requireMasterAdmin } from "./guards";
import type { AuthContext } from "./session";

// Page/layout Server Components can't handle a thrown ApiError the way API
// route handlers do (there's no wrapper turning it into a JSON response) —
// an uncaught throw there renders Next.js's generic "server-side exception"
// crash page instead of sending the visitor to /login. These wrap the same
// guards for use directly inside page.tsx/layout.tsx files.
export async function requireAuthForPage(): Promise<AuthContext> {
  try {
    return await requireAuth();
  } catch {
    redirect("/login");
  }
}

export async function requireCustomerAdminForPage(): Promise<AuthContext> {
  try {
    return await requireCustomerAdmin();
  } catch {
    redirect("/login");
  }
}

export async function requireMasterAdminForPage(): Promise<AuthContext> {
  try {
    return await requireMasterAdmin();
  } catch {
    redirect("/login");
  }
}
