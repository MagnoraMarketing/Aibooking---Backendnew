import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/outbound/phone";
import { dialerQueue } from "@/lib/outbound/lead-queue";
import { campaignCallOutcome } from "@/lib/outbound/outcome";
import { analyzeLeadCsv, parseCsv, leadVariables, toCsv, LEAD_CSV_TEMPLATE } from "@/lib/outbound/csv";

describe("normalizePhone", () => {
  it("keeps Danish numbers written with spaces valid", () => {
    expect(normalizePhone("+45 12 34 56 78")).toEqual({ ok: true, e164: "+4512345678", ambiguous: false });
  });

  it("adds the default country to a national number", () => {
    expect(normalizePhone("12 34 56 78")).toEqual({ ok: true, e164: "+4512345678", ambiguous: false });
    expect(normalizePhone("070-123 45 67", "SE")).toEqual({ ok: true, e164: "+46701234567", ambiguous: false });
  });

  it("reads a 00 prefix as +", () => {
    expect(normalizePhone("0045 12345678")).toMatchObject({ ok: true, e164: "+4512345678" });
  });

  it("accepts a country code without + but flags it", () => {
    expect(normalizePhone("4512345678")).toEqual({ ok: true, e164: "+4512345678", ambiguous: true });
  });

  it("rejects malformed numbers instead of guessing", () => {
    expect(normalizePhone("1234")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("+45 1234")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("ring efter 12")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizePhone("  ")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes and semicolons", () => {
    expect(parseCsv('phone;name\n+4512345678;"Hansen; Jens ""JH"""\n')).toEqual([
      ["phone", "name"],
      ["+4512345678", 'Hansen; Jens "JH"'],
    ]);
  });
});

describe("analyzeLeadCsv", () => {
  it("parses the downloadable template as one valid lead with custom fields", () => {
    const analysis = analyzeLeadCsv(LEAD_CSV_TEMPLATE);
    expect(analysis.summary).toEqual({ total: 1, valid: 1, invalid: 0, missingPhone: 0, duplicates: 0 });
    expect(analysis.customColumns).toEqual(["city", "industry"]);
    expect(analysis.rows[0]).toMatchObject({
      phone: "+4512345678",
      name: "Jens Hansen",
      company: "Eksempel ApS",
      email: "jens@eksempel.dk",
      notes: "Interesseret i en demo",
      customData: { city: "Aarhus", industry: "Webshop" },
    });
  });

  it("counts invalid, missing and duplicate rows separately", () => {
    const csv = [
      "Telefon,Navn,Firma,Postnr",
      "12345678,Anna,A ApS,8000",
      "+45 12 34 56 78,Anna igen,,",
      "12,Forkert,,",
      ",Uden nummer,,",
      "87654321,Bo,,2100",
    ].join("\n");
    const { summary, rows } = analyzeLeadCsv(csv);
    expect(summary).toEqual({ total: 5, valid: 2, invalid: 1, missingPhone: 1, duplicates: 1 });
    expect(rows.map((r) => r.status)).toEqual(["valid", "duplicate", "invalid", "missing_phone", "valid"]);
    expect(rows[0]!.customData).toEqual({ postnr: "8000" });
    expect(rows[2]!.line).toBe(4);
  });

  it("still accepts the old header-less 'number, name, company' lines", () => {
    const { rows } = analyzeLeadCsv("+4512345678, Jens Jensen, Jensen ApS\n+4587654321");
    expect(rows.map((r) => [r.phone, r.name, r.company])).toEqual([
      ["+4512345678", "Jens Jensen", "Jensen ApS"],
      ["+4587654321", null, null],
    ]);
  });

  it("rejects a row with a malformed email", () => {
    expect(analyzeLeadCsv("phone,email\n12345678,ikke-en-mail").rows[0]!.status).toBe("invalid");
  });
});

describe("leadVariables", () => {
  it("exposes known and custom fields, dropping empty ones", () => {
    expect(
      leadVariables({ phone: "+4512345678", name: "Jens", company: null, customData: { city: "Aarhus", tom: "" } })
    ).toEqual({ city: "Aarhus", phone: "+4512345678", name: "Jens" });
  });
});

describe("toCsv", () => {
  it("quotes cells that need it", () => {
    expect(toCsv(["a", "b"], [["x,y", 'z"']])).toBe('a,b\n"x,y","z"""\n');
  });
});


describe("dialerQueue", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  const leads = [
    { id: "fresh-1", status: "pending", next_call_at: null },
    { id: "done", status: "called", next_call_at: null },
    { id: "dnc", status: "do_not_call", next_call_at: null },
    { id: "cb-later", status: "callback", next_call_at: "2026-09-24T12:00:00Z" },
    { id: "cb-due-2", status: "callback", next_call_at: "2026-09-24T09:30:00Z" },
    { id: "cb-due-1", status: "callback", next_call_at: "2026-09-23T09:00:00Z" },
    { id: "fresh-2", status: "pending", next_call_at: null },
  ];

  it("offers due callbacks first, then fresh leads, never do-not-call", () => {
    expect(dialerQueue(leads, now).map((l) => l.id)).toEqual(["cb-due-1", "cb-due-2", "fresh-1", "fresh-2"]);
  });

  it("leaves out leads skipped this session", () => {
    expect(dialerQueue(leads, now, new Set(["cb-due-1", "fresh-1"])).map((l) => l.id)).toEqual(["cb-due-2", "fresh-2"]);
  });
});

describe("campaignCallOutcome", () => {
  it("reads unanswered calls from the ended reason", () => {
    expect(campaignCallOutcome("voicemail", null)).toBe("voicemail");
    expect(campaignCallOutcome("customer-busy", null)).toBe("busy");
    expect(campaignCallOutcome("customer-did-not-answer", null)).toBe("no_answer");
    expect(campaignCallOutcome("twilio-failed-to-connect-call", null)).toBe("failed");
  });

  it("uses the agent's own verdict for an answered call, when it gives a known one", () => {
    expect(campaignCallOutcome("customer-ended-call", { structuredData: { outcome: "meeting_booked" } })).toBe("meeting_booked");
    expect(campaignCallOutcome("assistant-ended-call", { structuredData: { outcome: "whatever" } })).toBe("answered");
    expect(campaignCallOutcome("customer-ended-call", null)).toBe("answered");
  });
});
