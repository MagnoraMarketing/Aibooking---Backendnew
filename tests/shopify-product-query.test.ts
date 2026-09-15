import { describe, it, expect } from "vitest";
import { parseProductQuery, variantMatchesTerms } from "@/lib/shopify/product-search";

// Turning what a customer says into a Shopify product query. This is the step
// that decides whether "Har I Nike-sko i størrelse 42?" finds anything at all:
// "42" has to be recognised as a variant option rather than sent to a product
// search that indexes titles and tags but not option values.

describe("parseProductQuery", () => {
  it("separates the product from the size the customer asked for", () => {
    const parsed = parseProductQuery("Har I Nike-sko i størrelse 42?");

    expect(parsed.variantTerms).toEqual(["42"]);
    expect(parsed.productTerms).toEqual(expect.arrayContaining(["nike", "sko"]));
    expect(parsed.shopifyQuery).toContain("title:nike*");
    // "størrelse" names the attribute, not the product — searching for it
    // would match nothing.
    expect(parsed.shopifyQuery).not.toContain("størrelse");
  });

  it("searches every field Shopify indexes, so a brand in the vendor still matches", () => {
    const parsed = parseProductQuery("Nike");
    expect(parsed.shopifyQuery).toBe(
      "(title:nike* OR tag:nike* OR product_type:nike* OR vendor:nike*)"
    );
  });

  it("requires all of the customer's words, each of which may match any field", () => {
    const parsed = parseProductQuery("sorte løbesko");
    expect(parsed.shopifyQuery).toContain(" AND ");
    expect(parsed.shopifyQuery).toContain("title:sorte*");
    expect(parsed.shopifyQuery).toContain("title:løbesko*");
  });

  it("recognises letter sizes as variant terms too", () => {
    expect(parseProductQuery("regnjakke i XL").variantTerms).toEqual(["xl"]);
    expect(parseProductQuery("t-shirt str M").variantTerms).toEqual(["m"]);
  });

  // "Hvad sælger I?" names no product. Searching for the literal word would
  // answer "we don't stock that", which is both wrong and unhelpful.
  it("treats a question that names no product as a browse", () => {
    expect(parseProductQuery("Hvad sælger I?").shopifyQuery).toBeNull();
    expect(parseProductQuery("what do you sell").shopifyQuery).toBeNull();
    expect(parseProductQuery("").shopifyQuery).toBeNull();
  });

  // The customer's words are data, not query syntax. A stray quote or colon
  // would otherwise change which products the query returns.
  it("strips characters that carry meaning in Shopify's query syntax", () => {
    const parsed = parseProductQuery('sko" OR title:*');

    // The injected syntax has to survive only as inert words: no quote to
    // close a term early, and the bare "title:*" reduced to the literal term
    // "title" rather than a clause matching the shop's whole catalogue.
    expect(parsed.shopifyQuery).not.toContain('"');
    expect(parsed.shopifyQuery).not.toContain(":*");
    expect(parsed.shopifyQuery).toContain("title:sko*");
    expect(parsed.shopifyQuery).toContain("title:title*");
  });
});

describe("variantMatchesTerms", () => {
  const variant = {
    title: "Sort / 42",
    options: [
      { name: "Farve", value: "Sort" },
      { name: "Størrelse", value: "42" },
    ],
  };

  it("matches on an option value, case-insensitively", () => {
    expect(variantMatchesTerms(variant, ["42"])).toBe(true);
    expect(variantMatchesTerms(variant, ["sort"])).toBe(true);
    expect(variantMatchesTerms(variant, ["Sort", "42"])).toBe(true);
  });

  // Whole values only: offering size 142 or 42.5 to someone who asked for 42
  // is the kind of near-miss that sells the wrong shoe.
  it("does not match a partial value", () => {
    expect(variantMatchesTerms(variant, ["4"])).toBe(false);
    expect(variantMatchesTerms(variant, ["142"])).toBe(false);
    expect(variantMatchesTerms(variant, ["42.5"])).toBe(false);
  });

  it("requires every term the customer named", () => {
    expect(variantMatchesTerms(variant, ["hvid", "42"])).toBe(false);
  });

  it("matches everything when no size or colour was named", () => {
    expect(variantMatchesTerms(variant, [])).toBe(true);
  });
});
