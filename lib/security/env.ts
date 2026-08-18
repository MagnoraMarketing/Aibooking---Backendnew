import "server-only";
import { ApiError } from "@/types/errors";

// Reads a server-only credential env var (API key, secret, token) and
// rejects it outright if it's missing or contains newlines/tabs — those are
// invalid in HTTP header values, and the native fetch()/Headers API throws
// an opaque TypeError deep inside undici if one sneaks through, which
// errorResponse() would otherwise mask as "Something went wrong". This bit
// a real deployment: a key's value had been pasted into Vercel three times
// with line breaks between each copy. trim() alone only fixes leading/
// trailing whitespace, not whitespace pasted into the middle, so this
// validates explicitly and fails with a message that says what's wrong.
export function requireCredentialEnv(name: string, configurationHint: string): string {
  const raw = process.env[name];
  if (!raw) {
    throw ApiError.internal(configurationHint);
  }
  const value = raw.trim();
  if (/[\r\n\t]/.test(value)) {
    throw ApiError.internal(
      `${name} indeholder linjeskift eller tab — værdien er sandsynligvis indsat forkert (fx flere gange) i Vercel. Ryd feltet og indsæt værdien én gang uden mellemrum/linjeskift, og redeploy.`
    );
  }
  return value;
}
