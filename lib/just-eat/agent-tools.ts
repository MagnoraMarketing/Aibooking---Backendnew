import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { writeAuditLog } from "@/lib/security/audit";
import { normalizePhone } from "@/lib/uber-direct/agent-tools";
import { createJetDelivery, createJetEstimate, JetGoApiError, type JetAddress } from "./api";
import { loadJustEatConfig, type JustEatConfig } from "./connection";

// The Just Eat (JET Go) delivery tools an agent may call, and the one place
// they execute — the Vapi voice assistant (app/api/webhooks/vapi) and the
// Anthropic chat/relay loop (lib/conversation/tool-loop.ts) both dispatch
// here, exactly like Uber Direct's.
//
// Same flow as Uber's: estimate first (price and times read out), explicit
// yes, then create; status only for a delivery this agent made. The pickup is
// the business's own address from the agent's setup, never from the
// conversation. There is no cancel tool: JET Go's cancellation call isn't in
// the public docs, so a caller who wants to cancel is put through to the
// business instead of being told something was cancelled that wasn't.

export const JUST_EAT_TOOL_NAMES = ["justeat_delivery_quote", "justeat_create_delivery", "justeat_delivery_status"] as const;
export type JustEatToolName = (typeof JUST_EAT_TOOL_NAMES)[number];

export function isJustEatToolName(name: string): name is JustEatToolName {
  return (JUST_EAT_TOOL_NAMES as readonly string[]).includes(name);
}

const ADDRESS_PROPERTIES = {
  dropoff_street: { type: "string", description: "Leveringsadressens vej og husnummer, fx 'Vesterbrogade 12, 2. tv.'." },
  dropoff_postal_code: { type: "string", description: "Leveringsadressens postnummer, fx '1620'." },
  dropoff_city: { type: "string", description: "Leveringsadressens by, fx 'København V'." },
};

interface JustEatToolDefinition {
  name: JustEatToolName;
  description: string;
  parameters: Record<string, unknown>;
}

const DEFINITIONS: JustEatToolDefinition[] = [
  {
    name: "justeat_delivery_quote",
    description:
      "Henter pris og forventede tider for en levering med Just Eat-bud fra virksomheden til kundens adresse. Kald den ALTID før du opretter en levering, og læs pris og tid op for kunden. " +
      "Spørg om vej og husnummer, postnummer og by, og gentag adressen før du kalder den. Prisen gælder i 5 minutter — svaret indeholder 'request_id', som du skal bruge til justeat_create_delivery.",
    parameters: {
      type: "object",
      properties: {
        ...ADDRESS_PROPERTIES,
        dropoff_name: { type: "string", description: "Modtagerens fulde navn, hvis du har det." },
        dropoff_phone: { type: "string", description: "Modtagerens telefonnummer i internationalt format, fx +4512345678." },
        has_alcohol: { type: "boolean", description: "true hvis leveringen indeholder alkohol (buddet skal tjekke alder)." },
      },
      required: ["dropoff_street", "dropoff_postal_code", "dropoff_city"],
    },
  },
  {
    name: "justeat_create_delivery",
    description:
      "Bestiller leveringen hos Just Eat, så et bud henter hos virksomheden og kører ud til kunden. Kald den KUN med et 'request_id' fra justeat_delivery_quote fra de sidste 5 minutter, og først når kunden tydeligt har sagt ja til netop den pris. " +
      "Sig først at leveringen er bestilt, når svaret er kommet uden fejl. Er prisen udløbet, så hent en ny med justeat_delivery_quote.",
    parameters: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "'request_id' fra det seneste justeat_delivery_quote-svar." },
        dropoff_notes: { type: "string", description: "Evt. besked til buddet, fx opgang, dørkode eller etage (højst 275 tegn)." },
        order_reference: { type: "string", description: "Butikkens eget ordrenummer, hvis der er et." },
        order_value_dkk: { type: "number", description: "Ordrens værdi i kroner, hvis du kender den." },
      },
      required: ["request_id"],
    },
  },
  {
    name: "justeat_delivery_status",
    description:
      "Slår status og forventet leveringstid op på en Just Eat-levering, som denne agent har bestilt. Brug 'delivery_id' fra justeat_create_delivery eller butikkens ordrenummer som kunden oplyser. Gæt aldrig et nummer.",
    parameters: {
      type: "object",
      properties: {
        delivery_id: { type: "string", description: "Just Eat-leveringens id." },
        order_reference: { type: "string", description: "Butikkens ordrenummer, hvis kunden ikke har leverings-id'et." },
      },
    },
  },
];

export function buildJustEatVapiTools() {
  return DEFINITIONS.map((definition) => ({
    type: "function" as const,
    function: { name: definition.name, description: definition.description, parameters: definition.parameters },
  }));
}

export function buildJustEatAnthropicTools() {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters as { type: "object"; properties?: Record<string, unknown> },
  }));
}

export const JUST_EAT_TOOL_GUIDANCE =
  "Virksomheden kan levere med Just Eat-bud. Vil kunden have noget leveret, så: 1) få leveringsadressen (vej og nr., postnummer, by) og gentag den, 2) hent pris og tider med justeat_delivery_quote og læs dem op, 3) bestil først med justeat_create_delivery, når kunden har sagt ja til prisen. Spørger kunden til en levering, så brug justeat_delivery_status — gæt aldrig. Vil kunden annullere en Just Eat-levering, så sig at virksomheden kontakter dem, og lov ikke at den er annulleret.";

// When both Uber Direct and Just Eat are set up for the same agent.
export const BOTH_DELIVERY_GUIDANCE =
  "Virksomheden kan levere med både Uber Direct og Just Eat. Hent pris fra begge (uber_delivery_quote og justeat_delivery_quote), fortæl kunden begge priser og tider, og bestil med den kunden vælger.";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dropoffAddress(args: Record<string, unknown>, config: JustEatConfig): JetAddress | null {
  const street = str(args.dropoff_street);
  const postalCode = str(args.dropoff_postal_code);
  const city = str(args.dropoff_city);
  if (!street || !postalCode || !city) return null;
  return { street, postalCode, city, country: config.pickup.country };
}

function money(cents: number | undefined, currency: string | undefined): string | undefined {
  if (typeof cents !== "number") return undefined;
  return `${(cents / 100).toFixed(2)} ${(currency ?? "DKK").toUpperCase()}`.trim();
}

function describeFailure(err: unknown): Record<string, unknown> {
  if (err instanceof JetGoApiError) {
    if (err.status === 401 || err.status === 403) return { ok: false, error: "not_authorized" };
    if (err.status === 404 || /expired/i.test(err.message)) return { ok: false, error: "quote_expired" };
    if (err.status === 422 || /address|deliverable|range/i.test(err.message)) return { ok: false, error: "address_undeliverable" };
    return { ok: false, error: "rejected", code: err.code };
  }
  return { ok: false, error: "unavailable" };
}

async function findCreatedDelivery(widgetId: string, args: Record<string, unknown>) {
  const supabase = getAdminClient();
  const id = str(args.delivery_id);
  const reference = str(args.order_reference);
  if (!id && !reference) return null;

  let query = supabase
    .from("audit_logs")
    .select("entity_id, metadata")
    .eq("action", "just_eat.delivery_created")
    .eq("metadata->>widgetId", widgetId);
  query = id ? query.eq("entity_id", id) : query.eq("metadata->>orderReference", reference as string);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { deliveryId: data.entity_id as string, metadata: (data.metadata ?? {}) as Record<string, unknown> } : null;
}

async function latestStatus(widgetId: string, deliveryId: string): Promise<Record<string, unknown> | null> {
  const { data } = await getAdminClient()
    .from("audit_logs")
    .select("metadata, created_at")
    .eq("action", "just_eat.delivery_status")
    .eq("entity_id", deliveryId)
    .eq("metadata->>widgetId", widgetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? ({ ...(data.metadata as Record<string, unknown>), updated_at: data.created_at } as Record<string, unknown>) : null;
}

async function quote(config: JustEatConfig, args: Record<string, unknown>) {
  const dropoff = dropoffAddress(args, config);
  if (!dropoff) return { ok: false, error: "missing_address" };
  const phone = normalizePhone(str(args.dropoff_phone), config.pickup.country) ?? undefined;
  const estimate = await createJetEstimate(config.apiKey, {
    collect: { ...config.pickup },
    deliver: { ...dropoff, name: str(args.dropoff_name), phone },
    hasAlcohol: args.has_alcohol === true,
  });
  return {
    ok: true,
    request_id: estimate.requestId,
    price: money(estimate.feeCents, estimate.currency),
    collect_eta: estimate.collectEta,
    dropoff_eta: estimate.deliverEta,
    valid_minutes: 5,
  };
}

async function create(widgetId: string, customerId: string, config: JustEatConfig, args: Record<string, unknown>) {
  const requestId = str(args.request_id);
  if (!requestId) return { ok: false, error: "missing_quote" };
  const orderReference = str(args.order_reference);
  const valueDkk = typeof args.order_value_dkk === "number" && args.order_value_dkk > 0 ? args.order_value_dkk : undefined;

  const delivery = await createJetDelivery(config.apiKey, {
    requestId,
    specialInstructions: str(args.dropoff_notes),
    vendorOrderId: orderReference,
    orderValueCents: valueDkk !== undefined ? Math.round(valueDkk * 100) : undefined,
    // Echoed back on every webhook, so a status update can be tied to the
    // agent even before we have seen the delivery id.
    metadata: { widgetId, ...(orderReference ? { orderReference } : {}) },
  });

  await writeAuditLog({
    customerId,
    action: "just_eat.delivery_created",
    entityType: "just_eat_delivery",
    entityId: delivery.deliveryId,
    metadata: {
      widgetId,
      orderReference: orderReference ?? null,
      requestId,
      status: delivery.status ?? null,
      trackingUrl: delivery.trackingUrl ?? null,
    },
  });

  return {
    ok: true,
    delivery_id: delivery.deliveryId,
    status: delivery.status ?? "created",
    tracking_url: delivery.trackingUrl ?? null,
    dropoff_eta: delivery.deliverEta,
  };
}

async function status(widgetId: string, args: Record<string, unknown>) {
  const created = await findCreatedDelivery(widgetId, args);
  if (!created) return { ok: false, error: "not_found" };
  const latest = await latestStatus(widgetId, created.deliveryId);
  return {
    ok: true,
    delivery_id: created.deliveryId,
    status: (latest?.status as string | undefined) ?? (created.metadata.status as string | undefined) ?? "created",
    dropoff_eta: (latest?.deliverEta as string | undefined) ?? null,
    tracking_url: (latest?.trackingUrl as string | undefined) ?? (created.metadata.trackingUrl as string | undefined) ?? null,
    courier: (latest?.courierName as string | undefined) ?? null,
    updated_at: latest?.updated_at ?? null,
  };
}

// Returns JSON as a string, like the Uber and Shopify tools. Never throws: a
// tool that blows up mid-call leaves the caller in silence.
export async function executeJustEatTool(
  name: string,
  args: Record<string, unknown>,
  widgetId: string,
  customerId: string
): Promise<string> {
  try {
    const config = await loadJustEatConfig(widgetId);
    if (!config) return JSON.stringify({ ok: false, error: "not_connected" });

    if (name === "justeat_delivery_quote") return JSON.stringify(await quote(config, args));
    if (name === "justeat_create_delivery") return JSON.stringify(await create(widgetId, customerId, config, args));
    if (name === "justeat_delivery_status") return JSON.stringify(await status(widgetId, args));
    return JSON.stringify({ ok: false, error: "unknown_tool" });
  } catch (err) {
    console.error(`Just Eat tool ${name} failed:`, err);
    return JSON.stringify(describeFailure(err));
  }
}
