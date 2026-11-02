import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getPublicAppUrl } from "@/lib/app-url";
import { TRIAL_DAYS } from "@/lib/billing/trial";
import { sendEmail, PLATFORM_NOTIFICATION_TO } from "./client";
import {
  buildTrialFollowupEmailHtml,
  trialFollowupSubject,
  type TrialFollowupKind,
} from "./templates/trial-followup";

const DAY_MS = 24 * 60 * 60 * 1000;

// Where "Book et møde" / "Book et onboarding-møde" points. Set
// ONBOARDING_MEETING_URL to the booking page (Calendly, Cal.com, Google
// booking page …); until then the button opens a pre-filled mail to the
// platform inbox, so the mail never goes out with a dead button.
export function getOnboardingMeetingUrl(): string {
  const configured = process.env.ONBOARDING_MEETING_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  return `mailto:${PLATFORM_NOTIFICATION_TO}?subject=${encodeURIComponent("Book et møde om AIbooking.dk")}`;
}

// Which customers are due which mail, as a window on created_at.
//
//   day1 — at least 1 day old. The window reaches back to day 3 so a day the
//          job didn't run (deploy, outage) is caught up the next day rather
//          than skipped; any later and "tak for din interesse" reads oddly.
//   day6 — at least 6 days old and still inside the TRIAL_DAYS trial, i.e.
//          the day before it ends. Past the trial it's too late to say
//          "your trial ends tomorrow", so there's no catch-up beyond that.
//
// The job runs daily (vercel.json), so every customer passes through each
// window on exactly one run; the *_sent_at columns are what actually stop a
// second mail if it runs more often.
export function followupWindow(kind: TrialFollowupKind, now: Date): { from: Date; to: Date } {
  const t = now.getTime();
  if (kind === "day1") return { from: new Date(t - 3 * DAY_MS), to: new Date(t - 1 * DAY_MS) };
  return { from: new Date(t - TRIAL_DAYS * DAY_MS), to: new Date(t - (TRIAL_DAYS - 1) * DAY_MS) };
}

const SENT_COLUMN: Record<TrialFollowupKind, "followup_day1_sent_at" | "followup_day6_sent_at"> = {
  day1: "followup_day1_sent_at",
  day6: "followup_day6_sent_at",
};

interface DueCustomer {
  id: string;
  name: string;
  email: string;
  widget_launch_paid_at: string | null;
}

export interface TrialFollowupResult {
  day1: { sent: number; failed: number };
  day6: { sent: number; failed: number; skippedPaid: number };
}

// Sends every follow-up mail that is due right now. Called once a day by
// app/api/internal/trial-followups.
export async function sendDueTrialFollowups(now: Date = new Date()): Promise<TrialFollowupResult> {
  const result: TrialFollowupResult = {
    day1: { sent: 0, failed: 0 },
    day6: { sent: 0, failed: 0, skippedPaid: 0 },
  };

  for (const kind of ["day1", "day6"] as const) {
    const customers = await findDueCustomers(kind, now);
    const paid = kind === "day6" ? await findPaidCustomerIds(customers.map((c) => c.id)) : new Set<string>();

    for (const customer of customers) {
      // The day-6 mail is about deciding before the trial ends — a customer
      // who already paid has decided, and gets nothing.
      if (kind === "day6" && (customer.widget_launch_paid_at || paid.has(customer.id))) {
        result.day6.skippedPaid++;
        continue;
      }

      const outcome = await sendOne(kind, customer, now);
      if (outcome === "sent") result[kind].sent++;
      else if (outcome === "failed") result[kind].failed++;
    }
  }

  return result;
}

async function findDueCustomers(kind: TrialFollowupKind, now: Date): Promise<DueCustomer[]> {
  const { from, to } = followupWindow(kind, now);
  const { data, error } = await getAdminClient()
    .from("customers")
    .select("id, name, email, widget_launch_paid_at")
    .eq("trial_followups", true)
    .eq("status", "active")
    .eq("customer_type", "standard")
    .eq("is_platform_owned", false)
    .is(SENT_COLUMN[kind], null)
    .gt("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .returns<DueCustomer[]>();

  if (error) throw new Error(`Failed to load customers for ${kind} follow-up: ${error.message}`);
  return data ?? [];
}

// Same "paid" as lib/billing/trial.ts's getBillingStatus: a subscription in
// good standing. (widget_launch_paid_at is checked on the customer row.)
async function findPaidCustomerIds(customerIds: string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();
  const { data, error } = await getAdminClient()
    .from("subscriptions")
    .select("customer_id")
    .in("customer_id", customerIds)
    .in("status", ["active", "trialing"]);

  if (error) throw new Error(`Failed to load subscriptions for follow-up: ${error.message}`);
  return new Set((data ?? []).map((row: { customer_id: string }) => row.customer_id));
}

async function sendOne(
  kind: TrialFollowupKind,
  customer: DueCustomer,
  now: Date
): Promise<"sent" | "failed" | "already-claimed"> {
  const supabase = getAdminClient();
  const column = SENT_COLUMN[kind];

  // Claim first, send second: the conditional update only succeeds for one
  // caller, so two overlapping runs can never both mail the same customer.
  const { data: claimed, error: claimError } = await supabase
    .from("customers")
    .update({ [column]: now.toISOString() })
    .eq("id", customer.id)
    .is(column, null)
    .select("id");

  if (claimError) {
    console.error(`Trial follow-up (${kind}) claim failed for ${customer.id}:`, claimError.message);
    return "failed";
  }
  if (!claimed || claimed.length === 0) return "already-claimed";

  try {
    const language = await customerLanguage(customer.id);
    const appUrl = getPublicAppUrl();
    await sendEmail({
      to: customer.email,
      subject: trialFollowupSubject(kind, language),
      html: buildTrialFollowupEmailHtml({
        kind,
        language,
        companyName: customer.name,
        guideUrl: `${appUrl}/dashboard/getting-started`,
        meetingUrl: getOnboardingMeetingUrl(),
        billingUrl: `${appUrl}/dashboard/billing`,
      }),
      replyTo: PLATFORM_NOTIFICATION_TO,
    });
    return "sent";
  } catch (err) {
    // Release the claim so tomorrow's run tries again (still inside the
    // window for day1; for day6 only if the trial hasn't ended by then).
    await supabase.from("customers").update({ [column]: null }).eq("id", customer.id);
    console.error(`Trial follow-up (${kind}) failed for ${customer.id}:`, err instanceof Error ? err.message : err);
    return "failed";
  }
}

// The language picked on /signup lives on the customer's login profile.
async function customerLanguage(customerId: string): Promise<string> {
  const { data } = await getAdminClient()
    .from("profiles")
    .select("language")
    .eq("customer_id", customerId)
    .eq("role", "CUSTOMER_ADMIN")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ language: string | null }>();
  return data?.language ?? "da";
}
