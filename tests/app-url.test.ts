import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPublicAppUrl, isPubliclyReachableAppUrl, isStableAppUrl } from "@/lib/app-url";

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

    expect(getPublicAppUrl()).toBe("https://app.aibooking.dk");
  });

  it("falls back to the project's STABLE production domain, not this deployment's", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "aibooking-backendnew.vercel.app";
    process.env.VERCEL_URL = "aibooking-backendnew-abc123.vercel.app";

    // The whole point: an embed snippet built here must still resolve after
    // the next deploy, which a VERCEL_URL-derived one would not.
    expect(getPublicAppUrl()).toBe("https://aibooking-backendnew.vercel.app");
    expect(getPublicAppUrl()).not.toContain("abc123");
  });

  it("uses the per-deployment URL only when there is nothing better", () => {
    process.env.VERCEL_URL = "aibooking-backendnew-abc123.vercel.app";

    expect(getPublicAppUrl()).toBe("https://aibooking-backendnew-abc123.vercel.app");
  });

  it("falls back to localhost off Vercel", () => {
    expect(getPublicAppUrl()).toBe("http://localhost:3000");
  });

  it("strips a trailing slash, which an OAuth redirect_uri cannot tolerate", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.aibooking.dk/";
    expect(getPublicAppUrl()).toBe("https://app.aibooking.dk");
  });
});

describe("URLs a third party has to call back on", () => {
  it("reports localhost as unreachable, so callers skip rather than register it", () => {
    expect(isPubliclyReachableAppUrl()).toBe(false);
  });

  it("reports a Vercel-provided domain as reachable, unlike localhost", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "aibooking-backendnew.vercel.app";
    expect(isPubliclyReachableAppUrl()).toBe(true);
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
