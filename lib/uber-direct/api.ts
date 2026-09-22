import "server-only";

// Thin client for Uber Direct (Uber's delivery-as-a-service API): OAuth
// client-credentials token, delivery quote, create/get/cancel delivery.
//
// Flow, as Uber describes it: the customer orders → we send the order to
// Uber → Uber finds a courier → the courier picks up → delivers → status
// comes back to us (see app/api/webhooks/uber-direct).
//
// Addresses are sent as Uber's structured JSON string rather than one free
// text line — Uber recommends it because a structured address geocodes far
// more reliably, and a courier sent to the wrong street is the one failure
// nobody can fix from a chat window.

const DEFAULT_API_BASE = "https://api.uber.com";
const DEFAULT_AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const SCOPE = "eats.deliveries";

function apiBase(): string {
  return (process.env.UBER_DIRECT_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

function authUrl(): string {
  return process.env.UBER_DIRECT_AUTH_URL ?? DEFAULT_AUTH_URL;
}

export interface UberDirectCredentials {
  customerId: string;
  clientId: string;
  clientSecret: string;
}

export interface UberAddress {
  street: string;
  postalCode: string;
  city: string;
  country: string;
  state?: string;
}

export class UberDirectApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "UberDirectApiError";
  }
}

// Tokens live 30 days; one per client id is enough, and asking for a new
// one on every tool call would hit Uber's token rate limit mid-conversation.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearUberTokenCache(): void {
  tokenCache.clear();
}

async function getAccessToken(credentials: UberDirectCredentials): Promise<string> {
  const cached = tokenCache.get(credentials.clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const response = await fetch(authUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "client_credentials",
      scope: SCOPE,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new UberDirectApiError(`Uber auth failed (${response.status}): ${body.slice(0, 300)}`, response.status, "unauthorized");
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new UberDirectApiError("Uber auth returned no access token", 502, "unauthorized");

  tokenCache.set(credentials.clientId, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

async function uberRequest<T>(
  credentials: UberDirectCredentials,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken(credentials);
  const url = `${apiBase()}/v1/customers/${encodeURIComponent(credentials.customerId)}${path}`;

  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let code: string | null = null;
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      code = parsed.code ?? null;
      message = parsed.message ?? message;
    } catch {
      // Not JSON — keep the raw text.
    }
    if (response.status === 401) tokenCache.delete(credentials.clientId);
    throw new UberDirectApiError(`Uber Direct ${method} ${path} failed (${response.status}): ${message}`, response.status, code);
  }

  return (await response.json()) as T;
}

export function formatUberAddress(address: UberAddress): string {
  return JSON.stringify({
    street_address: [address.street],
    city: address.city,
    state: address.state ?? "",
    zip_code: address.postalCode,
    country: address.country,
  });
}

export interface UberQuote {
  id: string;
  fee: number;
  currency: string;
  dropoff_eta?: string;
  duration?: number;
  expires?: string;
}

export async function createUberQuote(
  credentials: UberDirectCredentials,
  params: { pickup: UberAddress; dropoff: UberAddress; pickupPhone?: string; dropoffPhone?: string }
): Promise<UberQuote> {
  const raw = await uberRequest<Record<string, unknown>>(credentials, "POST", "/delivery_quotes", {
    pickup_address: formatUberAddress(params.pickup),
    dropoff_address: formatUberAddress(params.dropoff),
    ...(params.pickupPhone ? { pickup_phone_number: params.pickupPhone } : {}),
    ...(params.dropoffPhone ? { dropoff_phone_number: params.dropoffPhone } : {}),
  });
  return {
    id: String(raw.id),
    fee: Number(raw.fee ?? 0),
    currency: String(raw.currency ?? raw.currency_type ?? ""),
    dropoff_eta: typeof raw.dropoff_eta === "string" ? raw.dropoff_eta : undefined,
    duration: typeof raw.duration === "number" ? raw.duration : undefined,
    expires: typeof raw.expires === "string" ? raw.expires : undefined,
  };
}

export interface UberDelivery {
  id: string;
  status: string;
  fee?: number;
  currency?: string;
  tracking_url?: string;
  dropoff_eta?: string;
  pickup_eta?: string;
  courier?: { name?: string; vehicle_type?: string; phone_number?: string } | null;
  external_id?: string;
}

function toDelivery(raw: Record<string, unknown>): UberDelivery {
  const courier = raw.courier as Record<string, unknown> | null | undefined;
  return {
    id: String(raw.id),
    status: String(raw.status ?? "unknown"),
    fee: typeof raw.fee === "number" ? raw.fee : undefined,
    currency: typeof raw.currency === "string" ? raw.currency : undefined,
    tracking_url: typeof raw.tracking_url === "string" ? raw.tracking_url : undefined,
    dropoff_eta: typeof raw.dropoff_eta === "string" ? raw.dropoff_eta : undefined,
    pickup_eta: typeof raw.pickup_eta === "string" ? raw.pickup_eta : undefined,
    courier: courier
      ? {
          name: typeof courier.name === "string" ? courier.name : undefined,
          vehicle_type: typeof courier.vehicle_type === "string" ? courier.vehicle_type : undefined,
          phone_number: typeof courier.phone_number === "string" ? courier.phone_number : undefined,
        }
      : null,
    external_id: typeof raw.external_id === "string" ? raw.external_id : undefined,
  };
}

export async function createUberDelivery(
  credentials: UberDirectCredentials,
  params: {
    quoteId: string;
    pickup: UberAddress;
    pickupName: string;
    pickupPhone: string;
    pickupNotes?: string;
    dropoff: UberAddress;
    dropoffName: string;
    dropoffPhone: string;
    dropoffNotes?: string;
    items: { name: string; quantity: number }[];
    externalId?: string;
  }
): Promise<UberDelivery> {
  const raw = await uberRequest<Record<string, unknown>>(credentials, "POST", "/deliveries", {
    quote_id: params.quoteId,
    pickup_name: params.pickupName,
    pickup_address: formatUberAddress(params.pickup),
    pickup_phone_number: params.pickupPhone,
    ...(params.pickupNotes ? { pickup_notes: params.pickupNotes } : {}),
    dropoff_name: params.dropoffName,
    dropoff_address: formatUberAddress(params.dropoff),
    dropoff_phone_number: params.dropoffPhone,
    ...(params.dropoffNotes ? { dropoff_notes: params.dropoffNotes } : {}),
    manifest_items: params.items.map((item) => ({ name: item.name, quantity: item.quantity, size: "small" })),
    ...(params.externalId ? { external_id: params.externalId } : {}),
  });
  return toDelivery(raw);
}

export async function getUberDelivery(credentials: UberDirectCredentials, deliveryId: string): Promise<UberDelivery> {
  const raw = await uberRequest<Record<string, unknown>>(
    credentials,
    "GET",
    `/deliveries/${encodeURIComponent(deliveryId)}`
  );
  return toDelivery(raw);
}

export async function cancelUberDelivery(credentials: UberDirectCredentials, deliveryId: string): Promise<UberDelivery> {
  const raw = await uberRequest<Record<string, unknown>>(
    credentials,
    "POST",
    `/deliveries/${encodeURIComponent(deliveryId)}/cancel`
  );
  return toDelivery(raw);
}
