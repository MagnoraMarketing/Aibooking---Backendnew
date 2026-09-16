import { describe, it, expect } from "vitest";
import { outboundNumberIssue, canPlaceOutboundFrom } from "@/lib/phone-numbers/outbound";

// Outbound used to demand a number bound to that exact agent AND refuse
// anything with direction='inbound'. Every Vapi number this platform hands
// out is created as inbound — that is what a customer forwards their company
// line to — and it is one number per agent, so between them the two rules
// left most agents unable to run a campaign at all with a paid-for number
// sitting right there.

const VAPI_NUMBER = {
  purchase_status: "active" as const,
  released_at: null,
  vapi_phone_number_id: "num_1",
  twilio_sid: null,
};

const TWILIO_NUMBER = {
  purchase_status: "active" as const,
  released_at: null,
  vapi_phone_number_id: null,
  twilio_sid: "PN123",
};

describe("which number an agent may run a campaign from", () => {
  // The whole point: the number's own agent no longer enters into it, and
  // neither does the direction it was set up to answer.
  it("lets a Vapi agent dial from a Vapi number, inbound or not", () => {
    expect(canPlaceOutboundFrom(VAPI_NUMBER, { usesVapi: true })).toBe(true);
  });

  it("lets an older Twilio-direct agent dial from a Twilio number", () => {
    expect(canPlaceOutboundFrom(TWILIO_NUMBER, { usesVapi: false })).toBe(true);
  });

  // Vapi's createOutboundCall takes a phoneNumberId from Vapi's own account,
  // and a Twilio call is placed from a number in the customer's subaccount.
  // Offering the wrong pairing fails per contact, inside a campaign that has
  // already been marked launched, in the vendor's own words.
  it("keeps a Twilio-direct agent off a number only Vapi knows", () => {
    expect(outboundNumberIssue(VAPI_NUMBER, { usesVapi: false })).toMatch(/Twilio/);
  });

  it("keeps a Vapi agent off a number Vapi has never seen", () => {
    expect(outboundNumberIssue(TWILIO_NUMBER, { usesVapi: true })).toMatch(/ikke registreret i Vapi/);
  });

  // A number imported into Vapi and still owned in Twilio serves either.
  it("accepts a number both providers know, whichever agent asks", () => {
    const both = { ...VAPI_NUMBER, twilio_sid: "PN123" };

    expect(canPlaceOutboundFrom(both, { usesVapi: true })).toBe(true);
    expect(canPlaceOutboundFrom(both, { usesVapi: false })).toBe(true);
  });
});

describe("a number that is not ready to dial", () => {
  it("refuses one whose purchase never completed", () => {
    expect(outboundNumberIssue({ ...VAPI_NUMBER, purchase_status: "failed" }, { usesVapi: true })).toMatch(
      /ikke aktivt/
    );
  });

  // Released rows are kept, not deleted (see lib/phone-numbers/service.ts),
  // so "still in the table" is not the same as "still ours to call from".
  it("refuses one that has been released", () => {
    const released = { ...VAPI_NUMBER, released_at: "2026-09-16T22:00:00Z" };

    expect(outboundNumberIssue(released, { usesVapi: true })).toMatch(/frigivet/);
  });

  it("names the release before the provider mismatch, since that is the fixable one", () => {
    const released = { ...VAPI_NUMBER, released_at: "2026-09-16T22:00:00Z" };

    expect(outboundNumberIssue(released, { usesVapi: false })).toMatch(/frigivet/);
  });
});
