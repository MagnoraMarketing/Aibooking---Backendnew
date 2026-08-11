import { vi } from "vitest";

// The real "server-only" package throws unconditionally when resolved via
// its default Node export condition (it only no-ops under the "react-server"
// condition that Next.js's RSC bundler sets). Stub it out for the test
// environment so lib/* modules that import it for safety (never bundle
// server code into the client) can still be unit tested under plain Node.
vi.mock("server-only", () => ({}));
