import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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

function getEncryptionKey(): Buffer {
  const raw = process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Missing required environment variable: CALENDAR_CREDENTIALS_ENCRYPTION_KEY");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CALENDAR_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)");
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
