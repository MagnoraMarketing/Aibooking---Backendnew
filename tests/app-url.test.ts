import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAppUrl, resolveAppUrlWithSource, resolvePublicAppUrl, isStableAppUrl } from "@/lib/app-url";

const VARS = ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
});

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("resolving our own address", () => {
  it("prefers the configured domain over anything Vercel provides", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.aibooking.dk";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "aibooking-backendnew.vercel.app";
    process.env.VERCEL_URL = "aibooking-backendnew-abc123.vercel.app";

    expect(resolveAppUrlWithSource()).toEqual({ url: "https://app.aibooking.dk", source: "configured" });
  });

  it("falls back to the project's STABLE production domain, not this deployment's", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "aibooking-backendnew.vercel.app";
    process.env.VERCEL_URL = "aibooking-backendnew-abc123.vercel.app";

    // The whole point: an embed snippet built here must still resolve after
    // the next deploy, which a VERCEL_URL-derived one would not.
    expect(resolveAppUrl()).toBe("https://aibooking-backendnew.vercel.app");
    expect(resolveAppUrl()).not.toContain("abc123");
  });

  it("uses the per-deployment URL only when there is nothing better", () => {
    process.env.VERCEL_URL = "aibooking-backendnew-abc123.vercel.app";

    expect(resolveAppUrlWithSource()).toEqual({
      url: "https://aibooking-backendnew-abc123.vercel.app",
      source: "vercel-deployment",
    });
  });

  it("falls back to localhost off Vercel", () => {
    expect(resolveAppUrlWithSource()).toEqual({ url: "http://localhost:3000", source: "local-fallback" });
  });

  it("strips a trailing slash, which an OAuth redirect_uri cannot tolerate", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.aibooking.dk/";
    expect(resolveAppUrl()).toBe("https://app.aibooking.dk");
  });
});

describe("URLs a third party has to call back on", () => {
  it("refuses localhost rather than handing out an address nothing can reach", () => {
    expect(resolvePublicAppUrl()).toBeNull();
  });

  it("accepts a Vercel-provided domain — it is reachable, unlike localhost", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "aibooking-backendnew.vercel.app";
    expect(resolvePublicAppUrl()).toBe("https://aibooking-backendnew.vercel.app");
  });
});

describe("whether an address is safe to give a customer for keeps", () => {
  it("counts a configured domain as stable", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.aibooking.dk";
    expect(isStableAppUrl()).toBe(true);
  });

  it("counts the production domain as stable", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "aibooking-backendnew.vercel.app";
    expect(isStableAppUrl()).toBe(true);
  });

  it("does NOT count a per-deployment URL as stable, even though it works today", () => {
    process.env.VERCEL_URL = "aibooking-backendnew-abc123.vercel.app";
    expect(isStableAppUrl()).toBe(false);
  });
});
