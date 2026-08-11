import "server-only";
import { ApiError } from "@/types/errors";
import { getAuthContext, type AuthContext } from "./session";

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw ApiError.unauthorized();
  return ctx;
}

export async function requireMasterAdmin(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (ctx.profile.role !== "MASTER_ADMIN") {
    throw ApiError.forbidden("Master admin access required");
  }
  return ctx;
}

export async function requireCustomerAdmin(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (ctx.profile.role !== "CUSTOMER_ADMIN" || !ctx.profile.customer_id) {
    throw ApiError.forbidden("Customer account required");
  }
  return ctx;
}

// Allows master admin (any customer) OR a customer admin scoped to exactly
// this customer. Use for endpoints admins can also inspect on behalf of a
// customer (e.g. /api/admin/customers/[id]/usage).
export async function requireCustomerAccess(customerId: string): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (ctx.profile.role === "MASTER_ADMIN") return ctx;
  if (ctx.profile.role === "CUSTOMER_ADMIN" && ctx.profile.customer_id === customerId) {
    return ctx;
  }
  throw ApiError.forbidden("You do not have access to this customer's data");
}
