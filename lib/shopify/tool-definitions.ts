import type { ShopifyCapabilities } from "./agent-tools";

// One definition of each Shopify tool, rendered into whichever shape the
// pipeline needs. Voice (Vapi) and chat (Anthropic) must describe the same
// tool identically — a difference in wording here is a difference in how the
// agent behaves on the phone versus in the widget, and that is exactly the
// kind of bug nobody finds until a customer reports it.
//
// The descriptions carry the guardrails, because they are what the model
// actually reads: never invent a product, a price or a link, never guess at an
// order, and never read an order out to someone who hasn't given its number.
//
// They also carry the product-link rule. The tools return the product's real
// `url` straight from Shopify, and the agent must use that exact string or no
// link at all — a plausible-looking URL built from the product name is a 404
// in front of a customer who was ready to buy.
//
// And they carry the rule that makes this integration API-first: the agent has
// no stored knowledge of the shop, so every question about a product, a price,
// stock, delivery or returns has to become a tool call. Each description says
// so in its own words, because "look it up, don't remember" is the behaviour
// that keeps a customer from being quoted last month's price.

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
      "Slår produkter op direkte i webshoppen via Shopify. Brug den HVER gang kunden spørger om et produkt, et produktnavn, en pris, en størrelse, en variant, en farve, et varenummer/SKU eller om noget er på lager — du må aldrig gætte eller huske disse oplysninger, og du må aldrig svare ud fra tidligere viden om shoppens sortiment. " +
      "Svaret er JSON med produktets navn, pris, valuta, varianter (størrelse/farve/SKU/lagerstatus) og feltet 'url'. " +
      "Nævner kunden en størrelse eller farve, står den i 'requested_options', og de varianter der matcher har 'matches_request': true — svar konkret på om netop den variant er på lager. " +
      "Når du nævner et produkt i en chat, skal du afslutte med et klikbart link i præcis formatet [Se produkt](url), hvor url er tolens 'url'-felt kopieret ordret. Opfind aldrig et link, og byg det aldrig selv ud fra produktnavnet. Er 'url' null, er produktet ikke online, og så nævner du intet link. " +
      "Under et telefonopkald læser du aldrig en URL højt — tilbyd i stedet at sende linket. " +
      "Er listen tom, fører shoppen ikke varen, og det siger du ærligt.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Hvad kunden leder efter, med deres egne ord — fx 'sorte løbesko', 'Nike sko i størrelse 42' eller 'regnjakke'. Tag størrelse og farve med, hvis kunden har nævnt dem.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_shopify_product",
    requires: "products",
    description:
      "Henter alle detaljer om ÉT bestemt produkt: beskrivelse, pris, alle varianter med størrelse, farve, SKU og lagerantal, hvilke kollektioner det ligger i, og produktets 'url'. " +
      "Brug den når du allerede ved hvilket produkt kunden mener — typisk efter search_shopify_products — og har brug for flere detaljer, fx alle tilgængelige størrelser eller den fulde beskrivelse. " +
      "Skal du finde produktet først, så brug search_shopify_products i stedet. " +
      "Nævner du produktet i en chat, afslutter du med [Se produkt](url) med 'url' kopieret ordret. Er 'url' null, er produktet ikke online, og så nævner du intet link.",
    parameters: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description:
            "Produktets 'handle' eller 'url' fra et tidligere tool-svar, eller produktets præcise navn. Gæt aldrig et handle.",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "get_shopify_shop_info",
    requires: "policies",
    description:
      "Henter webshoppens egne betingelser direkte fra Shopify: levering og leveringstid, fragtpriser, retur og refusion, handelsbetingelser og privatlivspolitik. " +
      "Brug den når kunden spørger om levering, fragt, returret, bytte eller betingelser — svar aldrig på den slags ud fra hukommelsen, da butikken selv redigerer teksterne. " +
      "Svaret er JSON med 'policies', hver med 'title', 'body' og 'url'. Sig det væsentlige med dine egne ord, og henvis til 'url' hvis kunden vil læse det hele.",
    parameters: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: { type: "string", enum: ["shipping", "refund", "terms", "privacy"] },
          description:
            "Hvilke betingelser der er brug for. Udelad for at hente dem alle. Spørger kunden om levering, så vælg 'shipping'; om retur eller bytte, 'refund'.",
        },
      },
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
