import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { writeAuditLog } from "@/lib/security/audit";
import {
  cancelUberDelivery,
  createUberDelivery,
  createUberQuote,
  getUberDelivery,
  UberDirectApiError,
  type UberAddress,
} from "./api";
import { loadUberDirectConfig, type UberDirectConfig } from "./connection";

// The delivery tools an agent may call, and the one place they execute — the
// Vapi voice assistant (app/api/webhooks/vapi) and the Anthropic chat/relay
// loop (lib/conversation/tool-loop.ts) both dispatch here, same as Shopify.
//
// The flow they enforce: quote first (price + ETA read out), explicit yes,
// then create; status and cancellation only for a delivery this agent made.
// The pickup address is the business's own and comes from the agent's setup,
// never from the conversation — a caller can choose where a delivery goes,
// not where the courier collects it.

export const UBER_TOOL_NAMES = [
  "uber_delivery_quote",
  "uber_create_delivery",
  "uber_delivery_status",
  "uber_cancel_delivery",
] as const;
export type UberToolName = (typeof UBER_TOOL_NAMES)[number];

export function isUberToolName(name: string): name is UberToolName {
  return (UBER_TOOL_NAMES as readonly string[]).includes(name);
}

const ADDRESS_PROPERTIES = {
  dropoff_street: { type: "string", description: "Leveringsadressens vej og husnummer, fx 'Vesterbrogade 12, 2. tv.'." },
  dropoff_postal_code: { type: "string", description: "Leveringsadressens postnummer, fx '1620'." },
  dropoff_city: { type: "string", description: "Leveringsadressens by, fx 'København V'." },
};

interface UberToolDefinition {
  name: UberToolName;
  description: string;
  parameters: Record<string, unknown>;
}

const DEFINITIONS: UberToolDefinition[] = [
  {
    name: "uber_delivery_quote",
    description:
      "Henter pris og forventet leveringstid for en Uber Direct-levering fra virksomheden til kundens adresse. Kald den ALTID før du opretter en levering, og læs pris og leveringstid op for kunden. " +
      "Spørg om vej og husnummer, postnummer og by, og gentag adressen for kunden før du kalder den. Prisen gælder i 15 minutter — svaret indeholder 'quote_id', som du skal bruge til uber_create_delivery.",
    parameters: {
      type: "object",
      properties: {
        ...ADDRESS_PROPERTIES,
        dropoff_phone: { type: "string", description: "Modtagerens telefonnummer i internationalt format, fx +4512345678." },
      },
      required: ["dropoff_street", "dropoff_postal_code", "dropoff_city"],
    },
  },
  {
    name: "uber_create_delivery",
    description:
      "Opretter leveringen hos Uber Direct, så en kurér henter hos virksomheden og kører ud til kunden. Kald den KUN med et 'quote_id' fra uber_delivery_quote, og først når kunden tydeligt har sagt ja til netop den pris og leveringstid. " +
      "Du skal have modtagerens navn og telefonnummer — læs telefonnummeret op og få det bekræftet. Svaret indeholder 'tracking_url' og 'delivery_id'. Sig først at leveringen er bestilt, når svaret er kommet uden fejl. " +
      "I en chat giver du tracking-linket som [Følg leveringen](tracking_url) med linket kopieret ordret; i et telefonopkald læser du aldrig linket højt, men fortæller at det bliver sendt på SMS fra Uber.",
    parameters: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "'quote_id' fra det seneste uber_delivery_quote-svar." },
        ...ADDRESS_PROPERTIES,
        dropoff_name: { type: "string", description: "Modtagerens fulde navn." },
        dropoff_phone: { type: "string", description: "Modtagerens telefonnummer i internationalt format, fx +4512345678." },
        dropoff_notes: { type: "string", description: "Evt. besked til kuréren, fx opgang, dørkode eller etage." },
        items: {
          type: "array",
          description: "Hvad der skal leveres.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Varens navn." },
              quantity: { type: "integer", description: "Antal." },
            },
            required: ["name", "quantity"],
          },
        },
        order_reference: { type: "string", description: "Butikkens eget ordrenummer, hvis der er et." },
      },
      required: ["quote_id", "dropoff_street", "dropoff_postal_code", "dropoff_city", "dropoff_name", "dropoff_phone", "items"],
    },
  },
  {
    name: "uber_delivery_status",
    description:
      "Slår status, forventet leveringstid, kurér og tracking-link op på en Uber-levering. Brug 'delivery_id' fra uber_create_delivery, eller butikkens ordrenummer som kunden oplyser. Gæt aldrig et nummer, og oplys aldrig om andre leveringer end den kunden spørger om.",
    parameters: {
      type: "object",
      properties: {
        delivery_id: { type: "string", description: "Uber-leveringens id (starter typisk med 'del_')." },
        order_reference: { type: "string", description: "Butikkens ordrenummer, hvis kunden ikke har leverings-id'et." },
      },
    },
  },
  {
    name: "uber_cancel_delivery",
    description:
      "Annullerer en Uber-levering. Bekræft altid med kunden, at leveringen skal annulleres, før du kalder den, og fortæl at en levering der allerede er hentet måske ikke kan annulleres.",
    parameters: {
      type: "object",
      properties: {
        delivery_id: { type: "string", description: "Uber-leveringens id." },
        order_reference: { type: "string", description: "Butikkens ordrenummer, hvis kunden ikke har leverings-id'et." },
      },
    },
  },
];

export function buildUberVapiTools() {
  return DEFINITIONS.map((definition) => ({
    type: "function" as const,
    function: { name: definition.name, description: definition.description, parameters: definition.parameters },
  }));
}

export function buildUberAnthropicTools() {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters as { type: "object"; properties?: Record<string, unknown> },
  }));
}

export const UBER_TOOL_GUIDANCE =
  "Virksomheden kan levere med Uber Direct. Vil kunden have noget leveret, så: 1) få leveringsadressen (vej og nr., postnummer, by) og gentag den, 2) hent pris og leveringstid med uber_delivery_quote og læs dem op, 3) få modtagerens navn og telefonnummer og gentag nummeret, 4) opret først leveringen med uber_create_delivery, når kunden har sagt ja til prisen. Spørger kunden til en levering, så brug uber_delivery_status — gæt aldrig.";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dropoffAddress(args: Record<string, unknown>, config: UberDirectConfig): UberAddress | null {
  const street = str(args.dropoff_street);
  const postalCode = str(args.dropoff_postal_code);
  const city = str(args.dropoff_city);
  if (!street || !postalCode || !city) return null;
  return { street, postalCode, city, country: config.pickup.country };
}

// Uber wants E.164. People say numbers without the country code, so a
// plain 8-digit number in a Danish setup gets +45.
export function normalizePhone(raw: string | undefined, country: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  if (/^00[1-9]\d{6,14}$/.test(digits)) return `+${digits.slice(2)}`;
  if (country === "DK" && /^\d{8}$/.test(digits)) return `+45${digits}`;
  return null;
}

function money(fee: number | undefined, currency: string | undefined): string | undefined {
  if (typeof fee !== "number") return undefined;
  return `${(fee / 100).toFixed(2)} ${(currency ?? "").toUpperCase()}`.trim();
}

function describeFailure(err: unknown): Record<string, unknown> {
  if (err instanceof UberDirectApiError) {
    if (err.code === "unauthorized" || err.status === 401) return { ok: false, error: "not_authorized" };
    if (err.code === "address_undeliverable" || err.code === "address_undeliverable_limited_couriers") {
      return { ok: false, error: "address_undeliverable" };
    }
    if (err.code === "expired_quote" || (err.code === "invalid_params" && /quote/i.test(err.message))) {
      return { ok: false, error: "quote_expired" };
    }
    return { ok: false, error: "rejected", code: err.code };
  }
  return { ok: false, error: "unavailable" };
}

async function findDeliveryIdByReference(widgetId: string, reference: string): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("entity_id")
    .eq("action", "uber_direct.delivery_created")
    .eq("metadata->>widgetId", widgetId)
    .eq("metadata->>orderReference", reference)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.entity_id as string | undefined) ?? null;
}

// Only a delivery this agent created may be looked up or cancelled: the id
// has to be one we logged for this widget.
async function deliveryBelongsToWidget(widgetId: string, deliveryId: string): Promise<boolean> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("id")
    .eq("action", "uber_direct.delivery_created")
    .eq("entity_id", deliveryId)
    .eq("metadata->>widgetId", widgetId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function resolveDeliveryId(widgetId: string, args: Record<string, unknown>): Promise<string | null> {
  const id = str(args.delivery_id);
  if (id) return (await deliveryBelongsToWidget(widgetId, id)) ? id : null;
  const reference = str(args.order_reference);
  return reference ? findDeliveryIdByReference(widgetId, reference) : null;
}

async function quote(widgetId: string, config: UberDirectConfig, args: Record<string, unknown>) {
  const dropoff = dropoffAddress(args, config);
  if (!dropoff) return { ok: false, error: "missing_address" };
  const result = await createUberQuote(config.credentials, {
    pickup: config.pickup,
    dropoff,
    pickupPhone: config.pickup.phone,
    dropoffPhone: normalizePhone(str(args.dropoff_phone), config.pickup.country) ?? undefined,
  });
  return {
    ok: true,
    quote_id: result.id,
    price: money(result.fee, result.currency),
    dropoff_eta: result.dropoff_eta,
    duration_minutes: result.duration,
    valid_until: result.expires,
  };
}

async function create(widgetId: string, customerId: string, config: UberDirectConfig, args: Record<string, unknown>) {
  const quoteId = str(args.quote_id);
  const dropoff = dropoffAddress(args, config);
  const dropoffName = str(args.dropoff_name);
  const dropoffPhone = normalizePhone(str(args.dropoff_phone), config.pickup.country);
  const items = Array.isArray(args.items)
    ? (args.items as Record<string, unknown>[])
        .map((item) => ({ name: str(item?.name) ?? "", quantity: Math.max(1, Math.round(Number(item?.quantity) || 1)) }))
        .filter((item) => item.name)
    : [];

  if (!quoteId) return { ok: false, error: "missing_quote" };
  if (!dropoff) return { ok: false, error: "missing_address" };
  if (!dropoffName) return { ok: false, error: "missing_name" };
  if (!dropoffPhone) return { ok: false, error: "invalid_phone" };
  if (items.length === 0) return { ok: false, error: "missing_items" };

  const orderReference = str(args.order_reference);
  const delivery = await createUberDelivery(config.credentials, {
    quoteId,
    pickup: config.pickup,
    pickupName: config.pickup.name,
    pickupPhone: config.pickup.phone,
    pickupNotes: config.pickup.notes,
    dropoff,
    dropoffName,
    dropoffPhone,
    dropoffNotes: str(args.dropoff_notes),
    items,
    externalId: orderReference,
  });

  await writeAuditLog({
    customerId,
    action: "uber_direct.delivery_created",
    entityType: "uber_delivery",
    entityId: delivery.id,
    metadata: {
      widgetId,
      orderReference: orderReference ?? null,
      status: delivery.status,
      trackingUrl: delivery.tracking_url ?? null,
      fee: delivery.fee ?? null,
      currency: delivery.currency ?? null,
    },
  });

  return {
    ok: true,
    delivery_id: delivery.id,
    status: delivery.status,
    tracking_url: delivery.tracking_url ?? null,
    price: money(delivery.fee, delivery.currency),
    dropoff_eta: delivery.dropoff_eta,
  };
}

async function status(widgetId: string, config: UberDirectConfig, args: Record<string, unknown>) {
  const deliveryId = await resolveDeliveryId(widgetId, args);
  if (!deliveryId) return { ok: false, error: "not_found" };
  const delivery = await getUberDelivery(config.credentials, deliveryId);
  return {
    ok: true,
    delivery_id: delivery.id,
    status: delivery.status,
    tracking_url: delivery.tracking_url ?? null,
    pickup_eta: delivery.pickup_eta,
    dropoff_eta: delivery.dropoff_eta,
    courier: delivery.courier ? { name: delivery.courier.name, vehicle: delivery.courier.vehicle_type } : null,
  };
}

async function cancel(widgetId: string, customerId: string, config: UberDirectConfig, args: Record<string, unknown>) {
  const deliveryId = await resolveDeliveryId(widgetId, args);
  if (!deliveryId) return { ok: false, error: "not_found" };
  const delivery = await cancelUberDelivery(config.credentials, deliveryId);
  await writeAuditLog({
    customerId,
    action: "uber_direct.delivery_canceled",
    entityType: "uber_delivery",
    entityId: deliveryId,
    metadata: { widgetId, status: delivery.status },
  });
  return { ok: true, delivery_id: deliveryId, status: delivery.status };
}

// Returns JSON as a string, like the Shopify tools. Never throws: a tool
// that blows up mid-call leaves the caller in silence.
export async function executeUberDirectTool(
  name: string,
  args: Record<string, unknown>,
  widgetId: string,
  customerId: string
): Promise<string> {
  try {
    const config = await loadUberDirectConfig(widgetId);
    if (!config) return JSON.stringify({ ok: false, error: "not_connected" });

    if (name === "uber_delivery_quote") return JSON.stringify(await quote(widgetId, config, args));
    if (name === "uber_create_delivery") return JSON.stringify(await create(widgetId, customerId, config, args));
    if (name === "uber_delivery_status") return JSON.stringify(await status(widgetId, config, args));
    if (name === "uber_cancel_delivery") return JSON.stringify(await cancel(widgetId, customerId, config, args));
    return JSON.stringify({ ok: false, error: "unknown_tool" });
  } catch (err) {
    console.error(`Uber Direct tool ${name} failed:`, err);
    return JSON.stringify(describeFailure(err));
  }
}
