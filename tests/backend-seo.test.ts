import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import robots from "@/app/robots";
// @ts-expect-error — plain .mjs config, no type declarations
import rawNextConfig from "@/next.config.mjs";
import type { NextConfig } from "next";
import { metadata } from "@/app/layout";
import { MARKETING_SITE_URL } from "@/lib/seo/marketing-site";

const nextConfig = rawNextConfig as NextConfig;

// The backend host must never rank — only www.aibooking.dk should — but
// it should still pass crawlers (and link value) on to the marketing site.

describe("backend is kept out of search indexes", () => {
  it("sends X-Robots-Tag: noindex on every path", async () => {
    const rules = await nextConfig.headers!();
    const catchAll = rules.find((rule) => rule.source === "/:path*");
    expect(catchAll?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
  });

  it("keeps the existing widget.js cache header", async () => {
    const rules = await nextConfig.headers!();
    const widget = rules.find((rule) => rule.source === "/widget.js");
    expect(widget?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=300" });
  });

  it("marks every page noindex but still followable", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it("lets crawlers fetch pages (so they see noindex) and the widget, but not the API", () => {
    const { rules } = robots();
    const rule = (Array.isArray(rules) ? rules[0] : rules)!;
    expect(rule.allow).toEqual(expect.arrayContaining(["/", "/widget.js", "/api/widget/"]));
    expect(rule.disallow).toEqual(["/api/"]);
  });
});

describe("brand mentions link to the marketing site", () => {
  it("points at the canonical www host", () => {
    expect(MARKETING_SITE_URL).toBe("https://www.aibooking.dk");
  });

  it("widget.js links the Powered by line and still honours showBranding", () => {
    const source = readFileSync(path.resolve(__dirname, "../public/widget.js"), "utf8");
    expect(source).toContain('var MARKETING_SITE_URL = "https://www.aibooking.dk/";');
    expect(source).toContain("if (!config.showBranding) return");
    expect(source).not.toContain('["Powered by AIbooking.dk"]');
    expect(source.match(/buildBranding\(config, "/g)).toHaveLength(4);
  });
});
