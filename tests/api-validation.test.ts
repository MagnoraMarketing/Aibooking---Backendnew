import { describe, it, expect } from "vitest";
import {
  createCustomerSchema,
  widgetUpdateSchema,
  manualCreditAdjustmentSchema,
  packageInputSchema,
} from "@/lib/security/schemas";
import { readJsonBody, errorResponse } from "@/lib/security/http";
import { ApiError } from "@/types/errors";

describe("input validation schemas", () => {
  it("accepts a valid create-customer payload", () => {
    const result = createCustomerSchema.safeParse({ name: "Acme A/S", email: "kontakt@acme.dk" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email on customer creation", () => {
    const result = createCustomerSchema.safeParse({ name: "Acme A/S", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a widget color that isn't a hex code", () => {
    const result = widgetUpdateSchema.safeParse({ primaryColor: "blue" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid widget color", () => {
    const result = widgetUpdateSchema.safeParse({ primaryColor: "#4F46E5" });
    expect(result.success).toBe(true);
  });

  it("rejects a manual credit adjustment of exactly zero minutes", () => {
    const result = manualCreditAdjustmentSchema.safeParse({
      customerId: "11111111-1111-1111-1111-111111111111",
      minutes: 0,
      description: "no-op",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative included_minutes on a package", () => {
    const result = packageInputSchema.safeParse({
      packageName: "Test",
      monthlyPrice: 999,
      includedMinutes: -5,
    });
    expect(result.success).toBe(false);
  });
});

describe("readJsonBody", () => {
  it("parses and validates a well-formed request body", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", email: "a@b.dk" }),
    });
    const body = await readJsonBody(request, createCustomerSchema);
    expect(body.name).toBe("Acme");
  });

  it("throws a 400 ApiError on invalid JSON", async () => {
    const request = new Request("http://localhost/api/test", { method: "POST", body: "not json" });
    await expect(readJsonBody(request, createCustomerSchema)).rejects.toMatchObject({ status: 400 });
  });

  it("throws a 400 ApiError when required fields are missing", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await expect(readJsonBody(request, createCustomerSchema)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an oversized body", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-length": String(200 * 1024) },
      body: JSON.stringify({ name: "x", email: "a@b.dk" }),
    });
    await expect(readJsonBody(request, createCustomerSchema)).rejects.toMatchObject({ status: 400 });
  });
});

describe("errorResponse", () => {
  it("maps ApiError to its status/code", async () => {
    const res = errorResponse(ApiError.forbidden("nope"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("never leaks internal error details for unexpected errors", async () => {
    const res = errorResponse(new Error("db password is hunter2"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).not.toContain("hunter2");
  });
});
