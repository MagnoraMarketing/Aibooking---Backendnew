import { NextResponse } from "next/server";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp, writeAuditLog, signupSchema } from "@/lib/security";
import { selfSignupCustomer } from "@/lib/customers/self-signup";
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

  return NextResponse.json({ success: true }, { status: 201 });
});
