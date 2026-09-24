import { describe, it, expect } from "vitest";
import {
  isDialable,
  canLaunch,
  canPause,
  canResume,
  canEditSettings,
  canChangeAgentOrNumber,
  canReplaceAllContacts,
} from "@/lib/outbound/status";
import { planContactList, type ExistingContact } from "@/lib/outbound/contacts";
import { campaignStatsFor } from "@/lib/outbound/stats";
import { finishCompletedCampaigns } from "@/lib/outbound/dialer";

// A campaign used to be "draft" or "launched", and a launched one could not
// be stopped, edited or looked into: no pause, no per-contact result, and an
// edit that would have deleted the calls already made. These are the rules
// that replaced that.

describe("what a campaign in each state allows", () => {
  it("dials only while running", () => {
    expect(isDialable("running")).toBe(true);
    expect(isDialable("paused")).toBe(false);
    expect(isDialable("draft")).toBe(false);
    expect(isDialable("completed")).toBe(false);
    expect(isDialable("failed")).toBe(false);
  });

  it("offers start, pause and resume one at a time", () => {
    expect(canLaunch("draft")).toBe(true);
    expect(canLaunch("running")).toBe(false);
    expect(canPause("running")).toBe(true);
    expect(canPause("paused")).toBe(false);
    expect(canResume("paused")).toBe(true);
    expect(canResume("completed")).toBe(false);
  });

  // The purpose, the hours and the retries only decide calls not yet placed,
  // so they stay editable for as long as there is one left.
  it("keeps settings editable until the campaign is over", () => {
    expect(canEditSettings("draft")).toBe(true);
    expect(canEditSettings("running")).toBe(true);
    expect(canEditSettings("paused")).toBe(true);
    expect(canEditSettings("completed")).toBe(false);
    expect(canEditSettings("failed")).toBe(false);
  });

  // Agent and number decide what a call IS: swapping them mid-queue leaves
  // half a list answered by one agent from one number and half by another,
  // with nothing in the record saying which was which.
  it("holds the agent and the number still while calls are going out", () => {
    expect(canChangeAgentOrNumber("draft")).toBe(true);
    expect(canChangeAgentOrNumber("paused")).toBe(true);
    expect(canChangeAgentOrNumber("running")).toBe(false);
  });

  it("only lets the whole contact list be thrown away in a draft", () => {
    expect(canReplaceAllContacts("draft")).toBe(true);
    expect(canReplaceAllContacts("running")).toBe(false);
    expect(canReplaceAllContacts("paused")).toBe(false);
  });
});

const CALLED: ExistingContact = {
  id: "called",
  phone_number: "+4511111111",
  contact_name: "Jens",
  company: null,
  status: "completed",
  attempts: 1,
  last_called_at: "2026-09-17T09:00:00Z",
};

const UNTOUCHED: ExistingContact = {
  id: "untouched",
  phone_number: "+4522222222",
  contact_name: "Mette",
  company: null,
  status: "pending",
  attempts: 0,
  last_called_at: null,
};

describe("saving an edited contact list", () => {
  it("replaces the list wholesale in a draft, because nothing has happened yet", () => {
    const plan = planContactList([UNTOUCHED], [{ phoneNumber: "+4533333333" }], { replaceAll: true });

    expect(plan.delete).toEqual(["untouched"]);
    expect(plan.insert).toEqual([{ phoneNumber: "+4533333333" }]);
  });

  // The rule the whole merge exists for. A contact that has been called
  // carries its result, its recording and its billing record, and none of
  // that is ours to delete because someone edited a textarea.
  it("never deletes a contact that has been called", () => {
    const plan = planContactList([CALLED, UNTOUCHED], [], { replaceAll: false });

    expect(plan.delete).toEqual(["untouched"]);
    expect(plan.keptBecauseCalled).toBe(1);
  });

  // A failed attempt is a result too — "nobody picked up" is something the
  // campaign found out, and re-adding the number later would hide it.
  it("keeps a contact whose call failed", () => {
    const failed: ExistingContact = { ...UNTOUCHED, id: "failed", status: "failed", attempts: 1 };
    const plan = planContactList([failed], [], { replaceAll: false });

    expect(plan.delete).toEqual([]);
    expect(plan.keptBecauseCalled).toBe(1);
  });

  // Nor one that is ringing right now: it is a live conversation, and the
  // webhook is about to write its result against this row.
  it("keeps a contact that is on the line", () => {
    const calling: ExistingContact = { ...UNTOUCHED, id: "calling", status: "calling", attempts: 1 };
    const plan = planContactList([calling], [], { replaceAll: false });

    expect(plan.delete).toEqual([]);
    expect(plan.keptBecauseCalled).toBe(1);
  });

  it("adds numbers that were not in the list before", () => {
    const plan = planContactList([UNTOUCHED], [
      { phoneNumber: UNTOUCHED.phone_number, name: "Mette" },
      { phoneNumber: "+4544444444", name: "Ny", company: "Frisørstuen" },
    ], { replaceAll: false });

    expect(plan.insert).toEqual([{ phoneNumber: "+4544444444", name: "Ny", company: "Frisørstuen" }]);
    expect(plan.delete).toEqual([]);
  });

  // Correcting a name on a contact already called is allowed — it changes
  // the label, not what happened.
  it("corrects a name and company without touching the call behind it", () => {
    const plan = planContactList([CALLED], [
      { phoneNumber: CALLED.phone_number, name: "Jens Jensen", company: "Frisørstuen" },
    ], { replaceAll: false });

    expect(plan.update).toEqual([{ id: "called", contact_name: "Jens Jensen", company: "Frisørstuen" }]);
    expect(plan.delete).toEqual([]);
    expect(plan.keptBecauseCalled).toBe(0);
  });

  it("leaves an unchanged row alone", () => {
    const plan = planContactList([CALLED], [{ phoneNumber: CALLED.phone_number, name: "Jens" }], {
      replaceAll: false,
    });

    expect(plan).toEqual({ insert: [], update: [], delete: [], keptBecauseCalled: 0 });
  });
});

// A minimal stand-in for the PostgREST builder: enough of select/update/
// delete/eq/in/limit/order to run the two functions below against fixed rows,
// and to record what they tried to write.
interface Write {
  table: string;
  op: "update" | "delete";
  payload: Record<string, unknown> | null;
  ids: string[];
}

function fakeClient(tables: Record<string, Record<string, unknown>[]>, writes: Write[] = []) {
  function query(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let op: "select" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | null = null;

    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      update: (value: Record<string, unknown>) => {
        op = "update";
        payload = value;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      then: (resolve: (result: { data: Record<string, unknown>[]; error: null }) => void) => {
        const matched = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        if (op !== "select") {
          writes.push({ table, op, payload, ids: matched.map((row) => String(row.id)) });
          for (const row of matched) Object.assign(row, payload ?? {});
        }
        resolve({ data: matched, error: null });
      },
    };
    return builder;
  }

  return { from: (table: string) => query(table), writes } as unknown as Parameters<
    typeof finishCompletedCampaigns
  >[0] & { writes: Write[] };
}

describe("what a campaign amounts to", () => {
  it("counts contacts by outcome and adds up the minutes actually spoken", async () => {
    const supabase = fakeClient({
      outbound_campaign_contacts: [
        { id: "a", campaign_id: "c1", status: "completed", last_called_at: "2026-09-17T09:00:00Z" },
        { id: "b", campaign_id: "c1", status: "failed", last_called_at: "2026-09-17T10:00:00Z" },
        { id: "c", campaign_id: "c1", status: "pending", last_called_at: null },
        { id: "d", campaign_id: "c1", status: "calling", last_called_at: "2026-09-17T11:00:00Z" },
      ],
      phone_calls: [
        { campaign_contact_id: "a", duration_seconds: 90 },
        { campaign_contact_id: "b", duration_seconds: 5 },
      ],
    });

    const stats = await campaignStatsFor(["c1"], supabase);

    expect(stats.c1).toEqual({
      total: 4,
      // A contact still ringing is neither called nor waiting.
      called: 2,
      pending: 1,
      successful: 1,
      failed: 1,
      durationSeconds: 95,
      lastCallAt: "2026-09-17T11:00:00Z",
      calling: 1,
      outcomes: {},
    });
  });

  it("answers with zeroes for a campaign that has no contacts", async () => {
    const supabase = fakeClient({ outbound_campaign_contacts: [], phone_calls: [] });
    const stats = await campaignStatsFor(["empty"], supabase);

    expect(stats.empty).toEqual({
      total: 0,
      called: 0,
      pending: 0,
      successful: 0,
      failed: 0,
      durationSeconds: 0,
      lastCallAt: null,
      calling: 0,
      outcomes: {},
    });
  });
});

describe("closing a campaign that has nothing left to dial", () => {
  it("completes one whose contacts are all settled", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient(
      {
        outbound_campaigns: [{ id: "c1", status: "running" }],
        outbound_campaign_contacts: [
          { id: "a", campaign_id: "c1", status: "completed" },
          { id: "b", campaign_id: "c1", status: "failed" },
        ],
      },
      writes
    );

    expect(await finishCompletedCampaigns(supabase, new Date("2026-09-17T12:00:00Z"))).toBe(1);
    expect(writes[0]?.payload).toMatchObject({ status: "completed", finished_at: "2026-09-17T12:00:00.000Z" });
  });

  // A campaign that reached nobody did not succeed, and saying it completed
  // would bury exactly the thing worth looking at.
  it("marks a campaign that reached nobody as failed", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient(
      {
        outbound_campaigns: [{ id: "c1", status: "running" }],
        outbound_campaign_contacts: [{ id: "a", campaign_id: "c1", status: "failed" }],
      },
      writes
    );

    await finishCompletedCampaigns(supabase, new Date("2026-09-17T12:00:00Z"));
    expect(writes[0]?.payload).toMatchObject({ status: "failed" });
  });

  it("leaves a campaign alone while a contact is still waiting or ringing", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient(
      {
        outbound_campaigns: [{ id: "c1", status: "running" }],
        outbound_campaign_contacts: [
          { id: "a", campaign_id: "c1", status: "completed" },
          { id: "b", campaign_id: "c1", status: "calling" },
        ],
      },
      writes
    );

    expect(await finishCompletedCampaigns(supabase, new Date())).toBe(0);
    expect(writes).toEqual([]);
  });

  // Pausing must not look like finishing: the queue is intact, it is simply
  // not being worked.
  it("never closes a paused campaign", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient(
      {
        outbound_campaigns: [{ id: "c1", status: "paused" }],
        outbound_campaign_contacts: [{ id: "a", campaign_id: "c1", status: "completed" }],
      },
      writes
    );

    expect(await finishCompletedCampaigns(supabase, new Date())).toBe(0);
    expect(writes).toEqual([]);
  });
});
