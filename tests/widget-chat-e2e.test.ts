import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// End-to-end through the REAL route handlers: a visitor opens the widget,
// gets a session, sends a message, and the reply comes back — with the
// Shopify tools wired in where the widget has a connected store.
//
// Only the things outside this codebase are stubbed: Supabase, Anthropic,
// ElevenLabs and Shopify's HTTP API. Everything between the route handler and
// those edges is the code that ships, so this catches wiring that unit tests
// each mock away — the message route reaching the conversation loop, the loop
// reaching the Shopify tools, and the tool result reaching the model.

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the service-role Supabase client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

// The routes validate ids as UUIDs before they touch anything, so the fake
// database has to mint real ones — otherwise every request 400s and the test
// would be exercising the validator instead of the conversation.
let idCounter = 0;
function fakeUuid(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

function matches(row: Row, filters: [string, unknown][]): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

function makeQuery(table: string) {
  const filters: [string, unknown][] = [];
  let pending: Row[] | null = null;

  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: (tables[table] ?? []).find((row) => matches(row, filters)) ?? null, error: null }),
    single: async () => {
      const row = pending?.[0] ?? (tables[table] ?? []).find((r) => matches(r, filters)) ?? null;
      return { data: row, error: row ? null : { message: "not found" } };
    },
    insert: (payload: Row | Row[]) => {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
        id: row.id ?? fakeUuid(),
        created_at: new Date().toISOString(),
        ...row,
      }));
      tables[table] = [...(tables[table] ?? []), ...rows];
      pending = rows;
      return chain;
    },
    update: (patch: Row) => {
      for (const row of tables[table] ?? []) {
        if (matches(row, filters)) Object.assign(row, patch);
      }
      return chain;
    },
    upsert: (payload: Row) => {
      tables[table] = [...(tables[table] ?? []), payload];
      return chain;
    },
    delete: () => chain,
    // Awaiting the chain without maybeSingle()/single() yields the rows, the
    // way supabase-js resolves a builder.
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: (tables[table] ?? []).filter((row) => matches(row, filters)), error: null }),
  };

  return chain;
}

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({ from: (table: string) => makeQuery(table) }),
}));

// Credits, usage accounting and platform settings have their own tests; here
// they only need to not stand in the way of a conversation.
vi.mock("@/lib/credits", () => ({
  checkAndRefillIfNeeded: async () => ({ balanceSeconds: 6000, refilled: false }),
  getBalanceSeconds: async () => 6000,
  deductUsage: async () => {},
}));

const recordedUsage: Record<string, unknown>[] = [];
vi.mock("@/lib/usage", () => ({
  createUsageSession: async (params: { customerId: string; widgetId: string; conversationId: string }) => {
    // Mirrors the real insert's column names — the message route matches the
    // session's conversation_id against the one the browser sends.
    const row = {
      id: fakeUuid(),
      customer_id: params.customerId,
      widget_id: params.widgetId,
      conversation_id: params.conversationId,
      ended_at: null,
    };
    tables.usage_sessions = [...(tables.usage_sessions ?? []), row];
    return row;
  },
  appendTurnUsage: async (params: Record<string, unknown>) => {
    recordedUsage.push(params);
  },
  finalizeUsageSession: async (id: string) => ({ id, billed_duration_seconds: 12 }),
  setUsageSessionDuration: async () => {},
  recordLLMUsage: async () => {},
  recordTTSUsage: async () => {},
  estimateSpeechDurationSeconds: () => 12,
}));

vi.mock("@/lib/settings/platform", () => ({
  getDefaultSystemPrompt: async () => "Du er en hjælpsom assistent.",
  getSummarizationModelName: async () => "claude-haiku-4-5-20251001",
}));

vi.mock("@/lib/tts", () => ({
  resolveTTSProvider: () => ({
    name: "elevenlabs",
    synthesize: async () => ({ audioBase64: "AAAA", contentType: "audio/mpeg", charactersUsed: 42 }),
  }),
  estimateTTSCost: () => 0.001,
}));

// The model. Each test queues the turns it wants back.
const modelTurns: Anthropic.Message[] = [];
const modelCalls: Anthropic.MessageCreateParams[] = [];

const fakeAnthropicClient = {
  messages: {
    create: async (params: Anthropic.MessageCreateParams) => {
      modelCalls.push(params);
      return modelTurns.shift() ?? textTurn("Beklager, jeg har ikke mere at sige.");
    },
  },
};

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getAnthropicClient: () => fakeAnthropicClient,
    // The no-tools path goes through the provider rather than the client, so
    // both have to be fed by the same queue or the two paths would diverge.
    resolveLLMProvider: () => ({
      name: "anthropic",
      generateReply: async (params: { systemPrompt: string; messages: unknown[] }) => {
        modelCalls.push({
          system: params.systemPrompt,
          messages: params.messages,
        } as unknown as Anthropic.MessageCreateParams);
        const turn = modelTurns.shift() ?? textTurn("Beklager, jeg har ikke mere at sige.");
        const block = turn.content[0];
        return {
          content: block && block.type === "text" ? block.text : "",
          inputTokens: 10,
          outputTokens: 5,
        };
      },
      summarize: async () => ({ summary: "", inputTokens: 0, outputTokens: 0 }),
    }),
  };
});

function textTurn(text: string): Anthropic.Message {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Message;
}

function toolTurn(name: string, input: Record<string, unknown>): Anthropic.Message {
  return {
    content: [{ type: "tool_use", id: "tu_1", name, input }],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Message;
}

// Shopify's HTTP API.
const shopifyCalls: { query: string; variables: Record<string, unknown> }[] = [];
let shopifyResponder: (body: { query: string; variables: Record<string, unknown> }) => Response = () =>
  new Response(JSON.stringify({ data: { products: { nodes: [] } } }), {
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------------------

import { GET as getConfig } from "@/app/api/widget/config/route";
import { POST as postSession } from "@/app/api/widget/session/route";
import { POST as postMessage } from "@/app/api/widget/message/route";

const WIDGET = {
  id: "widget-1",
  customer_id: "cust-1",
  public_id: "pub-1",
  name: "Shoppen",
  status: "active",
  business_name: "Shoppen",
  llm_model_id: "llm-1",
  voice_model_id: "voice-1",
  language: "da",
  system_prompt: "Du er Shoppens assistent.",
  welcome_message: "Hej!",
  opening_message: "Hvad leder du efter?",
  primary_color: "#2563eb",
  secondary_color: "#111827",
  logo_url: null,
  avatar_url: null,
  position: "bottom-right",
  widget_size: "medium",
  show_branding: false,
  max_response_chars: 1200,
  booking_enabled: false,
};

function seed({ shopify }: { shopify?: Row | null } = {}) {
  for (const key of Object.keys(tables)) delete tables[key];
  tables.widgets = [{ ...WIDGET }];
  tables.customers = [{ id: "cust-1", status: "active", name: "Shoppen" }];
  tables.llm_models = [
    {
      id: "llm-1",
      provider: "anthropic",
      model_name: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      input_price_per_million: 1,
      output_price_per_million: 5,
      active: true,
    },
  ];
  tables.voice_models = [{ id: "voice-1", provider: "elevenlabs", provider_voice_id: "v1", name: "Lily", active: true }];
  tables.widget_settings = [{ widget_id: "widget-1", extra: {} }];
  tables.conversations = [];
  tables.conversation_messages = [];
  tables.conversation_summaries = [];
  tables.usage_sessions = [];
  tables.shopify_connections = shopify ? [shopify] : [];
}

const CONNECTED_SHOPIFY = {
  id: "conn-1",
  customer_id: "cust-1",
  widget_id: "widget-1",
  shop_domain: "shoppen.myshopify.com",
  access_token: "cipher:shpat_secret",
  scopes: "read_products,read_orders,read_legal_policies",
  status: "connected",
  status_error: null,
  connected_at: "2026-09-16T00:00:00Z",
};

vi.mock("@/lib/security/crypto", () => ({
  encryptSecret: (v: string) => `cipher:${v}`,
  decryptSecret: (v: string) => v.replace(/^cipher:/, ""),
}));

// Digs the tool result the agent was handed back out of the follow-up call.
function toolResultFrom(call: Anthropic.MessageCreateParams): Record<string, unknown> {
  for (const message of call.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (typeof block === "object" && block !== null && (block as { type?: string }).type === "tool_result") {
        return JSON.parse(String((block as { content?: unknown }).content)) as Record<string, unknown>;
      }
    }
  }
  throw new Error("No tool_result block was sent to the model");
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "https://kundens-site.dk" },
    body: JSON.stringify(body),
  });
}

async function openSessionAndSend(message: string) {
  const sessionRes = await postSession(jsonRequest("https://app.test/api/widget/session", { publicId: "pub-1" }), {
    params: {},
  });
  const session = await sessionRes.json();

  const messageRes = await postMessage(
    jsonRequest("https://app.test/api/widget/message", {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      message,
    }),
    { params: {} }
  );

  return { session, sessionRes, messageRes, reply: await messageRes.json() };
}

beforeEach(() => {
  idCounter = 0;
  modelTurns.length = 0;
  modelCalls.length = 0;
  shopifyCalls.length = 0;
  recordedUsage.length = 0;
  seed();

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/admin/api/") && url.includes("graphql.json")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      shopifyCalls.push(body);
      return shopifyResponder(body);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
});

describe("chat widget, end to end", () => {
  it("serves the public config the widget script renders from", async () => {
    const res = await getConfig(new Request("https://app.test/api/widget/config?publicId=pub-1"), { params: {} });
    const { config } = await res.json();

    expect(res.status).toBe(200);
    expect(config).toMatchObject({ publicId: "pub-1", businessName: "Shoppen", mode: "text", primaryColor: "#2563eb" });
    // The prompt is the business's own writing and never leaves the server.
    expect(JSON.stringify(config)).not.toContain("Du er Shoppens assistent");
  });

  it("opens a session and answers a message", async () => {
    modelTurns.push(textTurn("Vi har masser af sko."));

    const { session, messageRes, reply } = await openSessionAndSend("Hvad sælger I?");

    expect(session.sessionId).toBeTruthy();
    expect(session.openingMessage).toBe("Hvad leder du efter?");
    expect(messageRes.status).toBe(200);
    expect(reply.reply).toBe("Vi har masser af sko.");
    expect(reply.audioBase64).toBe("AAAA");
    // The turn was billed.
    expect(recordedUsage).toHaveLength(1);
  });

  it("stores both sides of the exchange for the next turn's context", async () => {
    modelTurns.push(textTurn("Vi har masser af sko."));
    await openSessionAndSend("Hvad sælger I?");

    expect((tables.conversation_messages ?? []).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rejects a message whose session does not match its conversation", async () => {
    modelTurns.push(textTurn("hej"));
    const sessionRes = await postSession(jsonRequest("https://app.test/api/widget/session", { publicId: "pub-1" }), {
      params: {},
    });
    const session = await sessionRes.json();

    const res = await postMessage(
      jsonRequest("https://app.test/api/widget/message", {
        sessionId: session.sessionId,
        conversationId: "00000000-0000-4000-8000-000000000000",
        message: "hej",
      }),
      { params: {} }
    );

    expect(res.status).toBe(404);
  });

  // Without a connected store there must be no Shopify tools at all — an
  // agent offered one would promise a lookup it cannot make.
  it("gives the model no Shopify tools when no store is connected", async () => {
    modelTurns.push(textTurn("Det ved jeg ikke."));
    await openSessionAndSend("Har I Nike i 42?");

    expect(shopifyCalls).toHaveLength(0);
  });
});

describe("Shopify, end to end through the chat widget", () => {
  beforeEach(() => seed({ shopify: { ...CONNECTED_SHOPIFY } }));

  it("answers a product question from a live Shopify lookup, with the real product link", async () => {
    shopifyResponder = () =>
      new Response(
        JSON.stringify({
          data: {
            products: {
              nodes: [
                {
                  title: "Nike Air Max",
                  handle: "nike-air-max",
                  onlineStoreUrl: "https://shoppen.dk/products/nike-air-max",
                  productType: "Løbesko",
                  vendor: "Nike",
                  status: "ACTIVE",
                  totalInventory: 4,
                  priceRangeV2: {
                    minVariantPrice: { amount: "899.00", currencyCode: "DKK" },
                    maxVariantPrice: { amount: "899.00", currencyCode: "DKK" },
                  },
                  variants: {
                    nodes: [
                      {
                        title: "Sort / 42",
                        sku: "S42",
                        price: "899.00",
                        availableForSale: true,
                        inventoryQuantity: 4,
                        selectedOptions: [
                          { name: "Farve", value: "Sort" },
                          { name: "Størrelse", value: "42" },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          },
        }),
        { headers: { "content-type": "application/json" } }
      );

    modelTurns.push(toolTurn("search_shopify_products", { query: "Nike i størrelse 42" }));
    modelTurns.push(
      textTurn("Ja, Nike Air Max findes i størrelse 42 til 899 DKK.\n[Se produkt](https://shoppen.dk/products/nike-air-max)")
    );

    const { reply } = await openSessionAndSend("Har I Nike i størrelse 42?");

    // The tool actually reached Shopify, with the customer's words in the query.
    expect(shopifyCalls).toHaveLength(1);
    expect(shopifyCalls[0]!.variables.query).toContain("title:nike*");

    // The tool result reached the model as a tool_result block.
    const result = toolResultFrom(modelCalls[1]!);
    expect(result.found).toBe(true);
    const product = (result.products as Record<string, unknown>[])[0]!;
    expect(product.url).toBe("https://shoppen.dk/products/nike-air-max");
    const variant = (product.variants as Record<string, unknown>[])[0]!;
    expect(variant).toMatchObject({ title: "Sort / 42", available: true, inventory: 4, matches_request: true });

    expect(reply.reply).toContain("[Se produkt](https://shoppen.dk/products/nike-air-max)");
  });

  it("offers the model every tool the granted scopes allow", async () => {
    modelTurns.push(textTurn("hej"));
    await openSessionAndSend("hej");

    const names = (modelCalls[0]!.tools ?? []).map((tool) => (tool as { name: string }).name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_shopify_products",
        "get_shopify_product",
        "get_shopify_shop_info",
        "get_shopify_order_status",
      ])
    );
  });

  it("looks an order up and hands back only status and tracking", async () => {
    shopifyResponder = () =>
      new Response(
        JSON.stringify({
          data: {
            orders: {
              nodes: [
                {
                  name: "#10482",
                  cancelledAt: null,
                  displayFulfillmentStatus: "FULFILLED",
                  fulfillments: [
                    {
                      createdAt: "2026-09-14T08:00:00Z",
                      displayStatus: "IN_TRANSIT",
                      trackingInfo: [{ company: "DHL", number: "123456789", url: "https://track.dhl.com/123456789" }],
                    },
                  ],
                },
              ],
            },
          },
        }),
        { headers: { "content-type": "application/json" } }
      );

    modelTurns.push(toolTurn("get_shopify_order_status", { order_number: "#10482" }));
    modelTurns.push(textTurn("Din ordre er sendt med DHL."));

    const { reply } = await openSessionAndSend("Hvor er min ordre? Nummeret er #10482");

    const result = toolResultFrom(modelCalls[1]!);
    expect(result).toMatchObject({
      found: true,
      order_number: "10482",
      tracking_number: "123456789",
      carrier: "DHL",
      tracking_url: "https://track.dhl.com/123456789",
    });
    // Nothing about the buyer travels with it.
    expect(Object.keys(result)).not.toContain("email");
    expect(Object.keys(result)).not.toContain("customer");
    expect(reply.reply).toBe("Din ordre er sendt med DHL.");
  });

  it("marks the connection for reconnection when Shopify rejects the token, without failing the turn", async () => {
    shopifyResponder = () => new Response("unauthorized", { status: 401 });

    modelTurns.push(toolTurn("search_shopify_products", { query: "sko" }));
    modelTurns.push(textTurn("Jeg kan desværre ikke slå produkter op lige nu."));

    const { messageRes, reply } = await openSessionAndSend("Har I sko?");

    expect(messageRes.status).toBe(200);
    expect(reply.reply).toContain("kan desværre ikke");
    expect(toolResultFrom(modelCalls[1]!)).toMatchObject({ found: false, error: "reauth_required" });
    expect(tables.shopify_connections![0]!.status).toBe("reauth_required");
  });

  // The token is the one thing that must never travel outward.
  it("never leaks the access token to the model or the browser", async () => {
    shopifyResponder = () =>
      new Response(JSON.stringify({ data: { products: { nodes: [] } } }), {
        headers: { "content-type": "application/json" },
      });

    modelTurns.push(toolTurn("search_shopify_products", { query: "sko" }));
    modelTurns.push(textTurn("Vi fører ikke sko."));

    const { reply, session } = await openSessionAndSend("Har I sko?");

    expect(JSON.stringify(modelCalls)).not.toContain("shpat_secret");
    expect(JSON.stringify(reply)).not.toContain("shpat_secret");
    expect(JSON.stringify(session)).not.toContain("shpat_secret");
  });

  it("sends the token to Shopify's own host and nowhere else", async () => {
    modelTurns.push(toolTurn("search_shopify_products", { query: "sko" }));
    modelTurns.push(textTurn("ok"));
    await openSessionAndSend("Har I sko?");

    const call = (globalThis.fetch as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]!;
    expect(String(call[0])).toContain("https://shoppen.myshopify.com/admin/api/");
    expect((call[1]!.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_secret");
  });
});
