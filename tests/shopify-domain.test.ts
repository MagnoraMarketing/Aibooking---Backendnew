import { describe, it, expect } from "vitest";
import {
  isMyshopifyDomain,
  normalizeMyshopifyDomain,
  normalizeOrderNumber,
  orderNameMatches,
} from "@/lib/shopify/domain";

describe("normalizeMyshopifyDomain", () => {
  it("accepts the forms a merchant actually types", () => {
    expect(normalizeMyshopifyDomain("myshop")).toBe("myshop.myshopify.com");
    expect(normalizeMyshopifyDomain("myshop.myshopify.com")).toBe("myshop.myshopify.com");
    expect(normalizeMyshopifyDomain("https://myshop.myshopify.com/admin")).toBe("myshop.myshopify.com");
    expect(normalizeMyshopifyDomain("  MyShop.MyShopify.com  ")).toBe("myshop.myshopify.com");
    expect(normalizeMyshopifyDomain("www.myshop.myshopify.com")).toBe("myshop.myshopify.com");
  });

  // This is the check that decides where an access token gets sent. A
  // suffix-match bug here hands a merchant's token to whoever registered the
  // lookalike domain, so each of these is a real attack, not a style nit.
  it("rejects lookalike domains", () => {
    expect(normalizeMyshopifyDomain("evil-myshopify.com")).toBeNull();
    expect(normalizeMyshopifyDomain("myshop.myshopify.com.attacker.net")).toBeNull();
    expect(normalizeMyshopifyDomain("myshopify.com")).toBeNull();
    expect(normalizeMyshopifyDomain("myshop.myshopify.co")).toBeNull();
    expect(normalizeMyshopifyDomain("https://attacker.net/?x=myshop.myshopify.com")).toBeNull();
    expect(normalizeMyshopifyDomain("")).toBeNull();
    expect(normalizeMyshopifyDomain(null)).toBeNull();
  });

  it("agrees with isMyshopifyDomain", () => {
    expect(isMyshopifyDomain("myshop.myshopify.com")).toBe(true);
    expect(isMyshopifyDomain("evil-myshopify.com")).toBe(false);
  });
});


describe("normalizeOrderNumber", () => {
  // The requirement that started this: "10482" and "#10482" are the same order.
  it("treats the hash-prefixed and bare forms as the same number", () => {
    expect(normalizeOrderNumber("10482")).toBe("10482");
    expect(normalizeOrderNumber("#10482")).toBe("10482");
    expect(normalizeOrderNumber("  #10482  ")).toBe("10482");
  });

  it("survives how a number arrives from a voice call", () => {
    // Dictated digit by digit, or read back with punctuation.
    expect(normalizeOrderNumber("1 0 4 8 2")).toBe("10482");
    expect(normalizeOrderNumber("#10482.")).toBe("10482");
    expect(normalizeOrderNumber("AIB-1042")).toBe("AIB-1042");
  });

  it("returns null rather than an empty search term", () => {
    // An empty query would match every order in the shop — never run one.
    expect(normalizeOrderNumber("")).toBeNull();
    expect(normalizeOrderNumber("#")).toBeNull();
    expect(normalizeOrderNumber("   ")).toBeNull();
    expect(normalizeOrderNumber(undefined)).toBeNull();
  });
});

describe("orderNameMatches", () => {
  it("matches across the '#' and case", () => {
    expect(orderNameMatches("#10482", "10482")).toBe(true);
    expect(orderNameMatches("#10482", "#10482")).toBe(true);
    expect(orderNameMatches("AIB-1042", "aib-1042")).toBe(true);
  });

  // Shopify's order search is a match, not an equality test. Without this,
  // asking about "1048" could read out order #10482 — someone else's.
  it("refuses a partial match", () => {
    expect(orderNameMatches("#10482", "1048")).toBe(false);
    expect(orderNameMatches("#110482", "10482")).toBe(false);
    expect(orderNameMatches("#10482", "")).toBe(false);
  });
});
