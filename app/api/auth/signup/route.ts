import { NextResponse } from "next/server";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp, writeAuditLog, signupSchema } from "@/lib/security";
import { selfSignupCustomer } from "@/lib/customers/self-signup";
import { notifyNewCustomerSignup } from "@/lib/email/internal-notifications";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`signup:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!allowed) throw ApiError.tooManyRequests("For mange forsøg på at oprette konto. Prøv igen senere.");

  const body = await readJsonBody(request, signupSchema);

  const result = await selfSignupCustomer({
    companyName: body.companyName,
    email: body.email,
    phone: body.phone,
    password: body.password,
    language: body.language ?? "da",
  });

  await writeAuditLog({
    actorId: result.userId,
    actorRole: "CUSTOMER_ADMIN",
    customerId: result.customer.id,
    action: "customer.self_signup",
    entityType: "customer",
    entityId: result.customer.id,
  });

  // Tells the platform inbox there's someone new to ring and welcome.
  // Awaited so it actually runs before the serverless function is frozen,
  // but it never throws — a mail outage must not fail a completed signup
  // (see lib/email/internal-notifications.ts).
  await notifyNewCustomerSignup({
    customer: result.customer,
    language: body.language ?? "da",
  });

  return NextResponse.json({ success: true }, { status: 201 });
});
