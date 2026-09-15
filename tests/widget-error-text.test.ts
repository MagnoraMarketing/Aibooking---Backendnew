import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The widget ships as a standalone browser IIFE, so its helpers can't be
// imported. Lift describeError out of the file that is actually served and
// exercise that — a copy pasted into the test would pass while the shipped
// code stayed broken, which is the whole failure mode here.
function loadDescribeError(): (value: unknown) => string | null {
  const source = readFileSync("public/widget.js", "utf8");
  const start = source.indexOf("function describeError(");
  if (start === -1) throw new Error("describeError is no longer in public/widget.js");

  // Walk braces to the end of the function body.
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  // new Function on purpose: the point is to run the bytes that are actually
  // served to a customer's browser, not a re-typed copy of them.
  return new Function(`${source.slice(start, end)}; return describeError;`)() as (v: unknown) => string | null;
}

const describeError = loadDescribeError();

describe("the text a customer sees when a call fails", () => {
  it("never renders an object as [object Object]", () => {
    // The exact shape behind the reported screenshot: Vapi hands back the
    // parsed body of a failed HTTP call under error.message.
    const vapiEvent = { error: { message: { message: "Bad Request", statusCode: 400 } } };

    const text = describeError(vapiEvent);

    expect(text).toBe("Bad Request");
    expect(String(text)).not.toContain("[object Object]");
  });

  it("reads a plain Error", () => {
    expect(describeError(new Error("Mikrofonen blev afvist"))).toBe("Mikrofonen blev afvist");
  });

  it("reads the shapes the old code already handled, so nothing regressed", () => {
    expect(describeError({ message: "direct" })).toBe("direct");
    expect(describeError({ errorMsg: "vapi style" })).toBe("vapi style");
    expect(describeError({ error: { message: "nested" } })).toBe("nested");
  });

  it("falls back to compact JSON when no field carries a string", () => {
    const text = describeError({ code: 42, fatal: true });

    expect(text).toContain("42");
    expect(String(text)).not.toContain("[object Object]");
  });

  it("gives up cleanly rather than inventing text", () => {
    expect(describeError(null)).toBeNull();
    expect(describeError(undefined)).toBeNull();
    expect(describeError({})).toBeNull();
    expect(describeError("   ")).toBeNull();
  });

  it("survives a circular object instead of throwing inside an error handler", () => {
    const circular: Record<string, unknown> = { code: 1 };
    circular.self = circular;

    expect(() => describeError(circular)).not.toThrow();
  });

  it("truncates a huge payload rather than flooding the status line", () => {
    const text = describeError({ blob: "x".repeat(5000) });

    expect(text!.length).toBeLessThanOrEqual(301);
    expect(text).toContain("…");
  });

  it("does not recurse forever on deeply nested wrappers", () => {
    let deep: Record<string, unknown> = { message: "bottom" };
    for (let i = 0; i < 20; i++) deep = { error: deep };

    expect(() => describeError(deep)).not.toThrow();
  });
});

describe("the shipped widget uses it everywhere a failure reaches the customer", () => {
  const source = readFileSync("public/widget.js", "utf8");

  it("leaves no error path concatenating a raw value into the status line", () => {
    // `err.message ? err.message : …` is exactly what produced the bug.
    expect(source).not.toContain("err && err.message ? err.message");
    expect(source).not.toContain("e.message || e.errorMsg");
  });

  it("routes every provider's failure through describeError", () => {
    // Vapi, Realtime and Twilio Relay each have a connect-failure path.
    const uses = source.match(/describeError\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(6);
  });
});
