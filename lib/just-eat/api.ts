import "server-only";

// Thin client for JET Go — Just Eat Takeaway.com's delivery-as-a-service:
// a Just Eat courier collects from the business and delivers to the customer,
// the same job Uber Direct does (lib/uber-direct). Flow: estimate (price and
// times, a requestId valid for 5 minutes) → the customer says yes → create
// the delivery with that requestId → status comes back by webhook
// (app/api/webhooks/just-eat).
//
// JET Go is partner-only: the API key, the sandbox and the full reference
// come with a Just Eat partner agreement (integrations@justeattakeaway.com,
// developers.just-eat.com/documentation/jet-go). What the public docs
// confirm is used as documented — bearer auth, POST /v1/delivery/estimate,
// POST /v1/delivery with requestId, specialInstructions (max 275 chars),
// orderValue/tip in cents, vendorOrderId, metadata, deliveryDetails.hasAlcohol.
// The address/contact shape of the estimate body is not public; it is built
// in buildEstimateBody() only, so onboarding can correct it in one place, and
// responses are read defensively for the same reason.

const DEFAULT_API_BASE = "https://api-daas.skipthedishes.com";

function apiBase(): string {
  return (process.env.JET_GO_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

export interface JetAddress {
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface JetContact {
  name: string;
  phone: string;
}

export class JetGoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "JetGoApiError";
  }
}

async function jetRequest<T>(apiKey: string, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let code: string | null = null;
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { code?: string; errorCode?: string; message?: string; error?: string };
      code = parsed.code ?? parsed.errorCode ?? parsed.error ?? null;
      message = parsed.message ?? message;
    } catch {
      // Not JSON — keep the raw text.
    }
    throw new JetGoApiError(`JET Go ${path} failed (${response.status}): ${message}`, response.status, code);
  }

  return (await response.json()) as T;
}

function address(a: JetAddress): Record<string, unknown> {
  return { line1: a.street, postalCode: a.postalCode, city: a.city, country: a.country };
}

// The one place the estimate request is shaped — see the module comment.
export function buildEstimateBody(params: {
  collect: JetAddress & JetContact & { notes?: string };
  deliver: JetAddress & Partial<JetContact>;
  hasAlcohol?: boolean;
}): Record<string, unknown> {
  return {
    collectDetails: {
      address: address(params.collect),
      name: params.collect.name,
      phone: params.collect.phone,
      ...(params.collect.notes ? { instructions: params.collect.notes } : {}),
    },
    deliverDetails: {
      address: address(params.deliver),
      ...(params.deliver.name ? { name: params.deliver.name } : {}),
      ...(params.deliver.phone ? { phone: params.deliver.phone } : {}),
    },
    deliveryDetails: { hasAlcohol: Boolean(params.hasAlcohol) },
  };
}

function firstString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

// Fees come as cents, either flat or as { amount, currency }.
function readFee(raw: Record<string, unknown>): { amount?: number; currency?: string } {
  for (const key of ["fee", "deliveryFee", "price", "totalFee"]) {
    const value = raw[key];
    if (typeof value === "number") return { amount: value, currency: firstString(raw, ["currency", "currencyCode"]) };
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const amount = typeof obj.amount === "number" ? obj.amount : typeof obj.value === "number" ? obj.value : undefined;
      if (amount !== undefined) {
        return { amount, currency: firstString(obj, ["currency", "currencyCode"]) ?? firstString(raw, ["currency"]) };
      }
    }
  }
  return {};
}

export interface JetEstimate {
  requestId: string;
  feeCents?: number;
  currency?: string;
  collectEta?: string;
  deliverEta?: string;
}

export async function createJetEstimate(
  apiKey: string,
  params: Parameters<typeof buildEstimateBody>[0]
): Promise<JetEstimate> {
  const raw = await jetRequest<Record<string, unknown>>(apiKey, "/v1/delivery/estimate", buildEstimateBody(params));
  const requestId = firstString(raw, ["requestId", "id", "estimateId"]);
  if (!requestId) throw new JetGoApiError("JET Go estimate returned no requestId", 502, "no_request_id");
  const fee = readFee(raw);
  return {
    requestId,
    feeCents: fee.amount,
    currency: fee.currency,
    collectEta: firstString(raw, ["estimatedCollectTime", "collectTime", "pickupEta"]),
    deliverEta: firstString(raw, ["estimatedDeliverTime", "estimatedDeliveryTime", "deliverTime", "dropoffEta"]),
  };
}

export interface JetDelivery {
  deliveryId: string;
  status?: string;
  trackingUrl?: string;
  deliverEta?: string;
}

export async function createJetDelivery(
  apiKey: string,
  params: {
    requestId: string;
    specialInstructions?: string;
    vendorOrderId?: string;
    orderValueCents?: number;
    metadata: Record<string, string>;
  }
): Promise<JetDelivery> {
  const raw = await jetRequest<Record<string, unknown>>(apiKey, "/v1/delivery", {
    requestId: params.requestId,
    ...(params.specialInstructions ? { specialInstructions: params.specialInstructions.slice(0, 275) } : {}),
    ...(params.vendorOrderId ? { vendorOrderId: params.vendorOrderId } : {}),
    ...(typeof params.orderValueCents === "number" ? { orderValue: params.orderValueCents } : {}),
    metadata: params.metadata,
  });
  return {
    deliveryId: firstString(raw, ["deliveryId", "id", "requestId"]) ?? params.requestId,
    status: firstString(raw, ["status", "state"]),
    trackingUrl: firstString(raw, ["trackingUrl", "tracking_url", "trackingLink"]),
    deliverEta: firstString(raw, ["estimatedDeliverTime", "estimatedDeliveryTime", "deliverTime"]),
  };
}
