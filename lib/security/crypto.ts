import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "@/types/errors";
import { requireCredentialEnv } from "./env";

// Encrypts sensitive third-party credentials at rest — currently just the
// Cal.com API key (calendar_connections.calcom_api_key; see
// app/api/customer/calendar/calcom/route.ts) — with AES-256-GCM. The key
// never leaves the server: every read site decrypts just-in-time to call
// the provider's API, and no route ever selects the ciphertext column back
// into a client-facing response.
//
// CALENDAR_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key
// (e.g. `openssl rand -base64 32`). Stored ciphertext is
// base64(iv (12 bytes) + authTag (16 bytes) + encrypted) so it round-trips
// as a single opaque string column.
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Via requireCredentialEnv rather than a bare throw: a plain Error reaches
// the browser as "Something went wrong" (errorResponse masks non-ApiError
// throws, deliberately, so internals never leak), and that is what a
// deployment missing this variable actually looked like — a customer pasting
// a perfectly good Cal.com key, getting an opaque failure, and no way to tell
// it apart from a rejected key. It also catches the line breaks an
// `openssl rand -base64 32` value picks up when it is pasted into Vercel.
function getEncryptionKey(): Buffer {
  const raw = requireCredentialEnv(
    "CALENDAR_CREDENTIALS_ENCRYPTION_KEY",
    "Kalenderintegrationen er ikke konfigureret på dette miljø endnu (mangler CALENDAR_CREDENTIALS_ENCRYPTION_KEY i miljøvariablerne)."
  );

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw ApiError.internal(
      "CALENDAR_CREDENTIALS_ENCRYPTION_KEY er sat forkert: værdien skal afkode til præcis 32 bytes (base64), fx fra `openssl rand -base64 32`."
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
