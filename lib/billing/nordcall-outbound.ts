import "server-only";
import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";
import { ensureStripeCustomer, getProductTaxCode } from "./checkout";
import { getSubscriptionPeriod } from "./subscription-sync";
import { getInvoiceSubscriptionId } from "./stripe-payload";
import { getAdminClient } from "@/lib/database/admin";
import { getPublicAppUrl } from "@/lib/app-url";
import type { Customer } from "@/types/database";
import { ApiError } from "@/types/errors";

// Nordcall Outbound is a separate product (its own app, sharing this
// Supabase project in the `nordcall` schema) that customers can add on top of
// their AIbooking package: a sales dialer with talk minutes per month. It is
// bought here, but its state lives in nordcall.outbound_subscriptions, written
// only through the nordcall.provision_outbound / update_outbound_subscription
// database functions. Keeping it out of public.subscriptions matters: every
// page here reads "the latest subscriptions row" as the customer's package,
// and invoice.paid grants package minutes for any row it finds there.

export const NORDCALL_ADDON_KEY = "nordcall_outbound";

export const NORDCALL_PLANS = {
  minutes_1000: { minutes: 1000, monthlyPriceDkk: 500, name: "Nordcall Outbound: 1.000 minutter / md." },
  minutes_2000: { minutes: 2000, monthlyPriceDkk: 800, name: "Nordcall Outbound: 2.000 minutter / md." },
} as const;
export type NordcallPlan = keyof typeof NORDCALL_PLANS;

export const NORDCALL_TRIAL = { minutes: 10, days: 7 } as const;

export function isNordcallPlan(value: unknown): value is NordcallPlan {
  return typeof value === "string" && value in NORDCALL_PLANS;
}

// Whether the Outbound menu item should open Nordcall straight away rather
// than the purchase page: the team has a running trial or plan.
export function hasNordcallAccess(status: NordcallOutboundStatus): boolean {
  return status.plan === "internal" || ((status.status === "active" || status.status === "trialing" || status.status === "past_due") && status.plan !== null);
}

export function getNordcallAppUrl(): string {
  return (process.env.NORDCALL_APP_URL ?? "https://outbound-dialer12.vercel.app").replace(/\/$/, "");
}

function nordcall() {
  return getAdminClient().schema("nordcall");
}

const CHECKOUT_API_VERSION = "2025-03-31.basil";

type ProvisionResult = { result: "ok" | "trial_used" | "not_team_admin" | "internal"; team_id: string; plan?: string; status?: string };

async function provision(params: {
  userId: string;
  plan: NordcallPlan | "trial";
  status: string;
  teamName?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<ProvisionResult> {
  const { data, error } = await nordcall().rpc("provision_outbound", {
    p_user: params.userId,
    p_plan: params.plan,
    p_status: params.status,
    p_team_name: params.teamName ?? null,
    p_period_start: params.periodStart ?? null,
    p_period_end: params.periodEnd ?? null,
    p_stripe_customer: params.stripeCustomerId ?? null,
    p_stripe_subscription: params.stripeSubscriptionId ?? null,
  });
  if (error) throw new Error(`Nordcall provisioning failed: ${error.message}`);
  return data as ProvisionResult;
}

// Stripe's subscription statuses mapped to the few Nordcall shows.
function toNordcallStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "canceled":
      return "canceled";
    case "incomplete_expired":
      return "expired";
    default:
      return "past_due";
  }
}

export type NordcallOutboundStatus = {
  plan: "trial" | NordcallPlan | "internal" | null;
  status: string | null;
  includedMinutes: number;
  usedMinutes: number;
  trialEndsAt: string | null;
  periodEnd: string | null;
  trialAvailable: boolean;
  teamAdmin: boolean;
};

// What the Outbound page shows: the user's Nordcall plan and this period's minutes.
export async function getNordcallOutboundStatus(userId: string): Promise<NordcallOutboundStatus> {
  const empty: NordcallOutboundStatus = {
    plan: null, status: null, includedMinutes: 0, usedMinutes: 0, trialEndsAt: null, periodEnd: null, trialAvailable: true, teamAdmin: true,
  };
  const { data: profile } = await nordcall().from("profiles").select("team_id, role").eq("id", userId).maybeSingle();
  if (!profile?.team_id) return empty;
  const teamAdmin = profile.role === "admin";
  const { data: sub } = await nordcall().from("outbound_subscriptions")
    .select("plan, status, included_minutes, trial_ends_at, current_period_start, current_period_end")
    .eq("team_id", profile.team_id).maybeSingle();
  if (!sub) return { ...empty, teamAdmin };
  // Nothing expires a trial in the database; past its end date it counts as over.
  const trialOver = sub.plan === "trial" && sub.trial_ends_at !== null && new Date(sub.trial_ends_at).getTime() < Date.now();
  let usage = nordcall().from("calls").select("duration_seconds").eq("team_id", profile.team_id).gte("started_at", sub.current_period_start);
  if (sub.current_period_end) usage = usage.lt("started_at", sub.current_period_end);
  const { data: calls } = await usage.limit(20000);
  const usedMinutes = (calls ?? []).reduce(
    (sum: number, call: { duration_seconds: number | null }) => sum + Math.ceil(Math.max(0, call.duration_seconds ?? 0) / 60), 0);
  return {
    plan: sub.plan,
    status: trialOver ? "expired" : sub.status,
    includedMinutes: sub.included_minutes,
    usedMinutes,
    trialEndsAt: sub.trial_ends_at,
    periodEnd: sub.current_period_end,
    trialAvailable: false,
    teamAdmin,
  };
}

// The free trial: 10 minutes for 7 days, no card, once per Nordcall team.
export async function startNordcallTrial(params: { userId: string; customer: Customer }): Promise<void> {
  const result = await provision({ userId: params.userId, plan: "trial", status: "trialing", teamName: params.customer.name });
  if (result.result === "trial_used") throw ApiError.conflict("Den gratis prøve er allerede brugt. Vælg en pakke for at fortsætte.");
  if (result.result === "not_team_admin") throw ApiError.forbidden("Din bruger er sælger i et andet Nordcall-team. Bed teamets administrator om at købe.");
}

// Stripe Checkout for a monthly Outbound plan. The subscription carries no
// aibooking_customer_id metadata on purpose, so the package sync ignores it;
// the webhook routes it here by NORDCALL_ADDON_KEY instead.
export async function createNordcallOutboundCheckout(params: {
  userId: string;
  customer: Customer;
  plan: NordcallPlan;
}): Promise<{ url: string }> {
  const current = await getNordcallOutboundStatus(params.userId);
  if (!current.teamAdmin) throw ApiError.forbidden("Din bruger er sælger i et andet Nordcall-team. Bed teamets administrator om at købe.");
  if (current.plan === "internal") throw ApiError.conflict("Jeres Nordcall-team har allerede fri adgang.");
  if ((current.plan === "minutes_1000" || current.plan === "minutes_2000") && (current.status === "active" || current.status === "past_due")) {
    throw ApiError.conflict("I har allerede en Outbound-pakke. Skift eller opsig den under Betaling → Administrer abonnement.");
  }

  const plan = NORDCALL_PLANS[params.plan];
  const stripe = getStripeClient();
  const stripeCustomerId = await ensureStripeCustomer(params.customer);
  const appUrl = getPublicAppUrl();
  const metadata = {
    aibooking_addon: NORDCALL_ADDON_KEY,
    nordcall_user_id: params.userId,
    nordcall_plan: params.plan,
    nordcall_team_name: params.customer.name ?? "",
  };
  const pinnedPrice = process.env[params.plan === "minutes_1000" ? "STRIPE_PRICE_ID_NORDCALL_1000" : "STRIPE_PRICE_ID_NORDCALL_2000"]?.trim();
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = pinnedPrice
    ? { price: pinnedPrice, quantity: 1 }
    : {
      price_data: {
        currency: "dkk",
        unit_amount: plan.monthlyPriceDkk * 100,
        recurring: { interval: "month" },
        product_data: { name: plan.name, tax_code: getProductTaxCode() },
      },
      quantity: 1,
    };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [lineItem],
        success_url: `${appUrl}/dashboard/outbound?checkout=success`,
        cancel_url: `${appUrl}/dashboard/outbound?checkout=cancelled`,
        metadata,
        subscription_data: { metadata },
      },
      { apiVersion: CHECKOUT_API_VERSION }
    );
  } catch (err) {
    throw ApiError.internal(`Stripe-fejl: ${err instanceof Error ? err.message : "Ukendt fejl fra Stripe."}`);
  }
  if (!session.url) throw ApiError.internal("Stripe returnerede ingen betalings-URL. Prøv igen.");
  return { url: session.url };
}

// Invoices carry their subscription's metadata at subscription_details
// (before the 2025-03-31 "basil" API version) or parent.subscription_details
// (basil and later); the webhook payload follows the endpoint's version.
function getInvoiceSubscriptionMetadata(invoice: Stripe.Invoice): Record<string, string> | null {
  const legacy = (invoice as unknown as { subscription_details?: { metadata?: Record<string, string> | null } | null }).subscription_details;
  if (legacy?.metadata) return legacy.metadata;
  const parent = (invoice as unknown as { parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null }).parent;
  return parent?.subscription_details?.metadata ?? null;
}

function isNordcallSubscription(subscription: Stripe.Subscription | null | undefined): boolean {
  return subscription?.metadata?.aibooking_addon === NORDCALL_ADDON_KEY;
}

async function syncNordcallSubscription(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.nordcall_user_id;
  const plan = subscription.metadata?.nordcall_plan;
  if (!userId || !isNordcallPlan(plan)) {
    throw new Error(`Nordcall subscription ${subscription.id} is missing nordcall_user_id/nordcall_plan metadata`);
  }
  const period = getSubscriptionPeriod(subscription);
  const result = await provision({
    userId,
    plan,
    status: toNordcallStatus(subscription.status),
    teamName: subscription.metadata?.nordcall_team_name || null,
    periodStart: new Date(period.start * 1000).toISOString(),
    periodEnd: new Date(period.end * 1000).toISOString(),
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
  });
  if (result.result === "not_team_admin") {
    console.error(`[nordcall] Subscription ${subscription.id} paid by a user who is not a Nordcall team admin (${userId}).`);
  }
}

async function setNordcallStatus(subscription: Stripe.Subscription, status: string): Promise<void> {
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  try {
    const period = getSubscriptionPeriod(subscription);
    periodStart = new Date(period.start * 1000).toISOString();
    periodEnd = new Date(period.end * 1000).toISOString();
  } catch { /* a cancelled subscription may have no current period */ }
  const plan = subscription.metadata?.nordcall_plan;
  const { error } = await nordcall().rpc("update_outbound_subscription", {
    p_stripe_subscription: subscription.id,
    p_status: status,
    p_plan: isNordcallPlan(plan) ? plan : null,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw new Error(`Nordcall status update failed: ${error.message}`);
}

// Handles every Stripe event that belongs to a Nordcall Outbound subscription
// and returns true; returns false for everything else so the regular package
// handling in the webhook runs unchanged. Throwing makes the webhook return
// 500, so Stripe retries.
export async function handleNordcallOutboundEvent(event: Stripe.Event, stripe: Stripe): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.aibooking_addon !== NORDCALL_ADDON_KEY) return false;
      if (typeof session.subscription === "string") {
        await syncNordcallSubscription(await stripe.subscriptions.retrieve(session.subscription));
      }
      return true;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isNordcallSubscription(subscription)) return false;
      await syncNordcallSubscription(subscription);
      return true;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      if (!isNordcallSubscription(subscription)) return false;
      await setNordcallStatus(subscription, "canceled");
      return true;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // Stripe copies the subscription's metadata onto its invoices, so the
      // add-on is recognized without a network call; package invoices pass
      // straight through to grantCreditsForPaidInvoice.
      if (getInvoiceSubscriptionMetadata(invoice)?.aibooking_addon !== NORDCALL_ADDON_KEY) return false;
      const subscriptionId = getInvoiceSubscriptionId(invoice);
      if (!subscriptionId) return true;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (event.type === "invoice.paid") await syncNordcallSubscription(subscription);
      else await setNordcallStatus(subscription, "past_due");
      return true;
    }
    default:
      return false;
  }
}
