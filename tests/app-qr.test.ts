import { describe, it, expect, vi } from "vitest";

const { toString } = vi.hoisted(() => ({ toString: vi.fn(async () => "<svg/>") }));
vi.mock("qrcode", () => ({ default: { toString } }));

import { GET } from "@/app/app-qr/route";

describe("login page QR code", () => {
  it("points at the domain the login page was opened on, not NEXT_PUBLIC_APP_URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://aibooking-backendnew.vercel.app";
    const res = await GET(new Request("https://app.aibooking.dk/app-qr"));

    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(toString).toHaveBeenCalledWith("https://app.aibooking.dk/login?app=1", expect.anything());
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
});
