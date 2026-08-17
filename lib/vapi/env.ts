import "server-only";

// VAPI_API_KEY is a private secret — never read it outside server-side code
// (route handlers, server components). VAPI_PUBLIC_KEY is safe for the
// browser but is still only ever read server-side here and threaded to the
// client explicitly as a prop/response field — see lib/database/env.ts for
// why a bare NEXT_PUBLIC_ var isn't used instead (not needed: this app
// already renders every widget-facing page server-side).
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const vapiEnv = {
  get apiKey() {
    return required("VAPI_API_KEY", process.env.VAPI_API_KEY);
  },
  get publicKey(): string | null {
    return process.env.VAPI_PUBLIC_KEY ?? null;
  },
  get webhookSecret(): string | null {
    return process.env.VAPI_WEBHOOK_SECRET ?? null;
  },
  get isConfigured(): boolean {
    return Boolean(process.env.VAPI_API_KEY);
  },
};
