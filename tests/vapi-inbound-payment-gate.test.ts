import { describe, it, expect, vi, beforeEach } from "vitest";

// A phone agent's free Vapi inbound number is a paid-plan feature — see
// app/api/customer/phone-numbers/vapi/route.ts and the payment gate there,
// which mirrors the one already in app/api/customer/phone-numbers/purchase/
// route.ts. These tests pin the actual assignment logic
// (provisionVapiNumberForWidget / provisionVapiNumbersForNewlyPaidCustomer),
// which both that route and the Stripe webhook call.

const ensureInboundAssistant = vi.fn(async () => "asst_1");
const createVapiManagedNumber = vi.fn(async () => ({ id: "num_1", number: "+15139407163" }));
const attachAssistantToVapiNumber = vi.fn(async () => {});
const listVapiPhoneNumbers = vi.fn(async () => [] as { id: string; number: string }[]);
const isVapiBillingRefusal = vi.fn(() => false);

vi.mock("@/lib/vapi", () => ({
  ensureInboundAssistant: (...args: unknown[]) => ensureInboundAssistant(...(args as [])),
  createVapiManagedNumber: (...args: unknown[]) => createVapiManagedNumber(...(args as [])),
  attachAssistantToVapiNumber: (...args: unknown[]) => attachAssistantToVapiNumber(...(args as [])),
  listVapiPhoneNumbers: (...args: unknown[]) => listVapiPhoneNumbers(...(args as [])),
  isVapiBillingRefusal: (...args: unknown[]) => isVapiBillingRefusal(...(args as [])),
}));

vi.mock("@/lib/security/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

// A minimal in-memory stand-in for the two tables this module touches:
// widgets (read-only here) and phone_numbers (read + insert).
let widgets: Array<{ id: string; name: string }>;
let phoneNumbers: Array<{ widget_id: string; source: string; released_at: string | null }>;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "widgets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: widgets, error: null }),
            }),
          }),
        };
      }
      if (table === "phone_numbers") {
        return {
          select: (cols: string) => {
            // provisionVapiNumberForWidget's own "already has a number" check
            // (single widget, .maybeSingle()).
            if (cols === "id") {
              return {
                eq: (_col: string, widgetId: string) => ({
                  eq: () => ({
                    is: () => ({
                      maybeSingle: async () => ({
                        data:
                          phoneNumbers.find(
                            (p) => p.widget_id === widgetId && p.source === "vapi" && p.released_at === null
                          ) ?? null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            }
            // provisionVapiNumbersForNewlyPaidCustomer's bulk "who already has
            // one" lookup (customer-wide, plain array).
            return {
              eq: () => ({
                eq: () => ({
                  is: () => Promise.resolve({ data: phoneNumbers, error: null }),
                }),
              }),
            };
          },
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                phoneNumbers.push({
                  widget_id: row.widget_id as string,
                  source: "vapi",
                  released_at: null,
                });
                return { data: { id: "phone_1", ...row }, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import {
  provisionVapiNumberForWidget,
  provisionVapiNumbersForNewlyPaidCustomer,
} from "@/lib/phone-numbers/vapi-provision";

describe("provisionVapiNumberForWidget", () => {
  beforeEach(() => {
    widgets = [];
    phoneNumbers = [];
    ensureInboundAssistant.mockClear();
    createVapiManagedNumber.mockClear();
  });

  it("asks Vapi for a number and stores it against the widget", async () => {
    const phoneNumber = await provisionVapiNumberForWidget({
      customerId: CUSTOMER_ID,
      widget: { id: "widget_1", name: "Frisørstuen" },
    });

    expect(ensureInboundAssistant).toHaveBeenCalledWith("widget_1");
    expect(createVapiManagedNumber).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: "asst_1", name: "Frisørstuen" })
    );
    expect(phoneNumber).toMatchObject({ vapi_phone_number_id: "num_1", phone_number: "+15139407163" });
  });

  it("refuses a second number for a widget that already has one", async () => {
    phoneNumbers.push({ widget_id: "widget_1", source: "vapi", released_at: null });

    await expect(
      provisionVapiNumberForWidget({ customerId: CUSTOMER_ID, widget: { id: "widget_1", name: "Frisørstuen" } })
    ).rejects.toThrow(/allerede et nummer/);
    expect(createVapiManagedNumber).not.toHaveBeenCalled();
  });
});

describe("provisionVapiNumbersForNewlyPaidCustomer", () => {
  beforeEach(() => {
    widgets = [];
    phoneNumbers = [];
    createVapiManagedNumber.mockClear();
    createVapiManagedNumber.mockImplementation(async () => ({ id: "num_1", number: "+15139407163" }));
  });

  it("provisions a number for every phone agent that doesn't have one yet", async () => {
    widgets = [
      { id: "widget_1", name: "Frisør A" },
      { id: "widget_2", name: "Frisør B" },
    ];

    await provisionVapiNumbersForNewlyPaidCustomer(CUSTOMER_ID);

    expect(createVapiManagedNumber).toHaveBeenCalledTimes(2);
  });

  it("skips a widget that already has an active Vapi number", async () => {
    widgets = [{ id: "widget_1", name: "Frisør A" }];
    phoneNumbers = [{ widget_id: "widget_1", source: "vapi", released_at: null }];

    await provisionVapiNumbersForNewlyPaidCustomer(CUSTOMER_ID);

    expect(createVapiManagedNumber).not.toHaveBeenCalled();
  });

  it("does not let one widget's failure stop the others from getting a number", async () => {
    widgets = [
      { id: "widget_1", name: "Frisør A" },
      { id: "widget_2", name: "Frisør B" },
    ];
    createVapiManagedNumber
      .mockRejectedValueOnce(new Error("Vapi is down"))
      .mockResolvedValueOnce({ id: "num_2", number: "+12125550123" });

    await expect(provisionVapiNumbersForNewlyPaidCustomer(CUSTOMER_ID)).resolves.toBeUndefined();
    expect(createVapiManagedNumber).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a customer with no phone agents", async () => {
    widgets = [];

    await provisionVapiNumbersForNewlyPaidCustomer(CUSTOMER_ID);

    expect(createVapiManagedNumber).not.toHaveBeenCalled();
  });
});
