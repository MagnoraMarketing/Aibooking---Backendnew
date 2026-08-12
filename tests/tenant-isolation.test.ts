import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/auth/session";

let mockContext: AuthContext | null;

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: async () => mockContext,
}));

import { requireMasterAdmin, requireCustomerAdmin, requireCustomerAccess } from "@/lib/auth/guards";
import { ApiError } from "@/types/errors";

function customerAdminContext(customerId: string): AuthContext {
  return {
    userId: `user-${customerId}`,
    email: `${customerId}@example.com`,
    profile: {
      id: `user-${customerId}`,
      role: "CUSTOMER_ADMIN",
      customer_id: customerId,
      full_name: null,
      language: "da",
      created_at: "",
      updated_at: "",
    },
  };
}

function masterAdminContext(): AuthContext {
  return {
    userId: "master-1",
    email: "admin@aibooking.dk",
    profile: {
      id: "master-1",
      role: "MASTER_ADMIN",
      customer_id: null,
      full_name: null,
      language: "da",
      created_at: "",
      updated_at: "",
    },
  };
}

describe("tenant isolation guards", () => {
  beforeEach(() => {
    mockContext = null;
  });

  it("rejects unauthenticated requests", async () => {
    await expect(requireCustomerAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it("customer A cannot access customer B's data", async () => {
    mockContext = customerAdminContext("customer-a");
    await expect(requireCustomerAccess("customer-b")).rejects.toBeInstanceOf(ApiError);
    await expect(requireCustomerAccess("customer-b")).rejects.toMatchObject({ status: 403 });
  });

  it("customer A can access their own data", async () => {
    mockContext = customerAdminContext("customer-a");
    const ctx = await requireCustomerAccess("customer-a");
    expect(ctx.profile.customer_id).toBe("customer-a");
  });

  it("master admin can access any customer's data", async () => {
    mockContext = masterAdminContext();
    const ctx = await requireCustomerAccess("customer-a");
    expect(ctx.profile.role).toBe("MASTER_ADMIN");
    const other = await requireCustomerAccess("customer-b");
    expect(other.profile.role).toBe("MASTER_ADMIN");
  });

  it("a customer admin cannot call master-admin-only endpoints", async () => {
    mockContext = customerAdminContext("customer-a");
    await expect(requireMasterAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("a master admin passes requireMasterAdmin", async () => {
    mockContext = masterAdminContext();
    const ctx = await requireMasterAdmin();
    expect(ctx.profile.role).toBe("MASTER_ADMIN");
  });
});
