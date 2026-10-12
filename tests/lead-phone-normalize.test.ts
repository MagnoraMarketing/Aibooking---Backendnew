import { describe, it, expect } from "vitest";
import { normalizeLeadPhoneNumber } from "@/lib/phone-numbers/normalize";

describe("normalizeLeadPhoneNumber", () => {
  it.each([
    ["+4512345678", "+4512345678"],
    ["+45 12 34 56 78", "+4512345678"],
    ["12 34 56 78", "+4512345678"],
    ["12-34-56-78", "+4512345678"],
    ["004512345678", "+4512345678"],
    ["4512345678", "+4512345678"],
    ["0046 70 123 45 67", "+46701234567"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeLeadPhoneNumber(input)).toBe(expected);
  });

  it("leaves what it can't read for the server to reject", () => {
    expect(normalizeLeadPhoneNumber("telefon")).toBe("telefon");
    expect(normalizeLeadPhoneNumber("1234")).toBe("1234");
  });
});
