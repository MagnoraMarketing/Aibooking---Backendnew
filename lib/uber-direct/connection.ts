import "server-only";
import type { z } from "zod";
import { getAdminClient } from "@/lib/database/admin";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import type { UberAddress, UberDirectCredentials } from "./api";

// An agent's Uber Direct setup lives in widget_settings.extra.uberDirect, next
// to the other per-agent integrations' settings. Secrets (client secret,
// webhook signing key) are stored encrypted and never leave the server: every
// route that hands `extra` to a browser goes through publicWidgetExtra().

export const UBER_EXTRA_KEY = "uberDirect";

interface StoredUberDirect {
  enabled?: boolean;
  customerId?: string;
  clientId?: string;
  clientSecretEncrypted?: string;
  webhookSigningKeyEncrypted?: string;
  pickup?: {
    name?: string;
    phone?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    notes?: string;
  };
}

export { uberDirectInputSchema } from "@/lib/security/schemas";
import type { uberDirectInputSchema } from "@/lib/security/schemas";
export type UberDirectInput = z.input<typeof uberDirectInputSchema>;

export interface UberDirectConfig {
  credentials: UberDirectCredentials;
  pickup: UberAddress & { name: string; phone: string; notes?: string };
  webhookSigningKey: string | null;
}

// Safe to show in a browser: which fields are set, never their secret values.
export interface UberDirectSummary {
  enabled: boolean;
  customerId: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  hasWebhookSigningKey: boolean;
  pickup: StoredUberDirect["pickup"] | null;
}

function stored(extra: Record<string, unknown> | null | undefined): StoredUberDirect | null {
  const value = extra?.[UBER_EXTRA_KEY];
  return value && typeof value === "object" ? (value as StoredUberDirect) : null;
}

export function summarizeUberDirect(extra: Record<string, unknown> | null | undefined): UberDirectSummary | null {
  const s = stored(extra);
  if (!s) return null;
  return {
    enabled: Boolean(s.enabled),
    customerId: s.customerId ?? null,
    clientId: s.clientId ?? null,
    hasClientSecret: Boolean(s.clientSecretEncrypted),
    hasWebhookSigningKey: Boolean(s.webhookSigningKeyEncrypted),
    pickup: s.pickup ?? null,
  };
}

// `extra` as it may be sent to a browser: the Uber Direct block is replaced
// by its summary, so ciphertexts never leave the server.
export function publicWidgetExtra(extra: Record<string, unknown>): Record<string, unknown> {
  if (!(UBER_EXTRA_KEY in extra)) return extra;
  return { ...extra, [UBER_EXTRA_KEY]: summarizeUberDirect(extra) };
}

// Merges an input into what is stored: new secrets are encrypted, omitted
// ones keep their stored value.
export function mergeUberDirectInput(
  extra: Record<string, unknown>,
  input: UberDirectInput
): Record<string, unknown> {
  const current = stored(extra) ?? {};
  const next: StoredUberDirect = {
    enabled: input.enabled,
    customerId: input.customerId,
    clientId: input.clientId,
    clientSecretEncrypted: input.clientSecret ? encryptSecret(input.clientSecret) : current.clientSecretEncrypted,
    webhookSigningKeyEncrypted: input.webhookSigningKey
      ? encryptSecret(input.webhookSigningKey)
      : current.webhookSigningKeyEncrypted,
    pickup: { ...input.pickup, country: (input.pickup.country ?? "DK").toUpperCase() },
  };
  return { ...extra, [UBER_EXTRA_KEY]: next };
}

export function removeUberDirect(extra: Record<string, unknown>): Record<string, unknown> {
  const { [UBER_EXTRA_KEY]: _removed, ...rest } = extra;
  return rest;
}

// The runtime view: only an enabled, complete setup counts. Anything missing
// means the agent is not given the delivery tools at all, rather than tools
// that can only fail in front of a customer.
export function resolveUberDirectConfig(extra: Record<string, unknown> | null | undefined): UberDirectConfig | null {
  const s = stored(extra);
  if (!s?.enabled || !s.customerId || !s.clientId || !s.clientSecretEncrypted) return null;
  const p = s.pickup;
  if (!p?.name || !p.phone || !p.street || !p.postalCode || !p.city) return null;

  let clientSecret: string;
  let webhookSigningKey: string | null = null;
  try {
    clientSecret = decryptSecret(s.clientSecretEncrypted);
    if (s.webhookSigningKeyEncrypted) webhookSigningKey = decryptSecret(s.webhookSigningKeyEncrypted);
  } catch (err) {
    console.error("Failed to decrypt Uber Direct credentials:", err);
    return null;
  }

  return {
    credentials: { customerId: s.customerId, clientId: s.clientId, clientSecret },
    pickup: {
      name: p.name,
      phone: p.phone,
      street: p.street,
      postalCode: p.postalCode,
      city: p.city,
      country: p.country ?? "DK",
      notes: p.notes,
    },
    webhookSigningKey,
  };
}

export async function loadUberDirectConfig(widgetId: string): Promise<UberDirectConfig | null> {
  const supabase = getAdminClient();
  const { data } = await supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return resolveUberDirectConfig((data?.extra as Record<string, unknown> | null) ?? null);
}
