import { NextResponse } from "next/server";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp, writeAuditLog, completeSignupSchema } from "@/lib/security";
import { getServerClient } from "@/lib/database/server";
import { resolveAuthContext } from "@/lib/auth/session";
import { selfSignupCustomer } from "@/lib/customers/self-signup";
import { notifyNewCustomerSignup } from "@/lib/email/internal-notifications";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// The auth project is shared with Nordcall, so a login can exist without an
// AIbooking account (someone who signed up for Nordcall first). The two
// products keep separate accounts: this gives that login its own AIbooking
// customer, trial and first agent, exactly like /api/auth/signup does for a
// brand-new email — without touching the Nordcall side.
export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`complete-signup:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!allowed) throw ApiError.tooManyRequests("For mange forsøg på at oprette konto. Prøv igen senere.");

  const resolution = await resolveAuthContext();
  if (resolution.status === "ok") throw ApiError.badRequest("Der findes allerede en AIbooking-konto til dette login");
  if (resolution.status !== "no-profile") throw ApiError.unauthorized("Log ind først");

  const {
    data: { user },
  } = await getServerClient().auth.getUser();
  if (!user?.email) throw ApiError.unauthorized("Log ind først");

  const body = await readJsonBody(request, completeSignupSchema);
  const language = body.language ?? "da";

  const result = await selfSignupCustomer({
    companyName: body.companyName,
    email: user.email,
    phone: body.phone,
    language,
    existingUserId: user.id,
  });

  await writeAuditLog({
    actorId: result.userId,
    actorRole: "CUSTOMER_ADMIN",
    customerId: result.customer.id,
    action: "customer.self_signup",
    entityType: "customer",
    entityId: result.customer.id,
  });

  await notifyNewCustomerSignup({ customer: result.customer, language, source: "complete-signup" });

  return NextResponse.json({ success: true }, { status: 201 });
});
