import type { ShopifyCapabilities } from "./agent-tools";

// One definition of each Shopify tool, rendered into whichever shape the
// pipeline needs. Voice (Vapi) and chat (Anthropic) must describe the same
// tool identically — a difference in wording here is a difference in how the
// agent behaves on the phone versus in the widget, and that is exactly the
// kind of bug nobody finds until a customer reports it.
//
// The descriptions carry the guardrails, because they are what the model
// actually reads: never invent a product or a price, never guess at an order,
// and never read an order out to someone who hasn't given its number.

interface ShopifyToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requires: keyof ShopifyCapabilities;
}

const DEFINITIONS: ShopifyToolDefinition[] = [
  {
    name: "search_shopify_products",
    requires: "products",
    description:
      "Slår produkter op i virksomhedens webshop. Brug den hver gang kunden spørger om et produkt, en pris, en størrelse, en farve eller om noget er på lager — du må aldrig gætte et produkt, en pris eller en variant. Svaret er JSON med navn, pris, varianter, lagerstatus og produktets URL; formulér selv svaret til kunden ud fra det. Er listen tom, findes produktet ikke i shoppen, og det skal du sige ærligt.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Hvad kunden leder efter, med deres egne ord — fx 'sorte løbesko', 'Nike Air Max størrelse 43' eller 'regnjakke'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_shopify_order_status",
    requires: "orders",
    description:
      "Slår status og tracking op på en ordre ud fra ordrenummeret. Spørg altid kunden om ordrenummeret først — du må aldrig kalde denne uden et nummer kunden selv har oplyst. Nummeret må gerne være med eller uden '#'. Svaret er JSON: er 'found' false, så sig at du ikke kunne finde ordren, og bed kunden tjekke nummeret og prøve igen — gæt aldrig på en anden ordre, og nævn aldrig oplysninger om andre ordrer.",
    parameters: {
      type: "object",
      properties: {
        order_number: {
          type: "string",
          description: "Ordrenummeret som kunden oplyser det, fx '10482' eller '#10482'.",
        },
      },
      required: ["order_number"],
    },
  },
];

function enabled(capabilities: ShopifyCapabilities): ShopifyToolDefinition[] {
  return DEFINITIONS.filter((definition) => capabilities[definition.requires]);
}

// Vapi's shape: tools declared on the model, executing at the assistant's
// serverUrl (app/api/webhooks/vapi).
export function buildShopifyVapiTools(capabilities: ShopifyCapabilities) {
  return enabled(capabilities).map((definition) => ({
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
  }));
}

// Anthropic's shape, for the chat/relay tool-use loop.
export function buildShopifyAnthropicTools(capabilities: ShopifyCapabilities) {
  return enabled(capabilities).map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters as { type: "object"; properties?: Record<string, unknown> },
  }));
}
