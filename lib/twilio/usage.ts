import "server-only";
import { twilioFetch, type TwilioCredentials } from "./client";

export interface TwilioCallMinutesSummary {
  balance: number;
  currency: string;
  inboundMinutesUsed: number;
  outboundMinutesUsed: number;
  // Best-effort estimate of how many more minutes the current balance
  // would stretch to for that direction, derived from Twilio's own live
  // per-minute voice pricing for Danish numbers — null if that lookup
  // failed or came back in a shape we didn't expect (see
  // getEstimatedMinutesRemaining below). Never guessed/hardcoded on our
  // side: either it's Twilio's own numbers end-to-end, or it's omitted.
  inboundMinutesRemaining: number | null;
  outboundMinutesRemaining: number | null;
}

interface UsageRecordsResponse {
  usage_records: { usage: string; usage_unit: string }[];
}

// Sums the `usage` field across whatever records the given date range
// returned — in practice this is a single aggregated record per category
// for most accounts (Twilio only breaks it into several when the range
// spans a lot of billing history with grouping requested, which we don't
// do here). Returns minutes; Twilio's own usage_unit for voice categories
// is already "minutes", not seconds.
function sumUsageMinutes(data: UsageRecordsResponse): number {
  return data.usage_records.reduce((total, record) => total + (parseFloat(record.usage) || 0), 0);
}

// Fetches lifetime call usage for one category ("calls-inbound" or
// "calls-outbound") — StartDate is pinned far in the past because a BYO
// Twilio trial's ~$15 credit never resets on a billing cycle the way a
// paid account's usage would, so the default "this period" window Twilio
// would otherwise apply is the wrong question here; we want all-time usage
// against a balance that only ever goes down.
async function getUsageMinutes(credentials: TwilioCredentials, category: "calls-inbound" | "calls-outbound"): Promise<number> {
  const response = await twilioFetch(
    `/Usage/Records.json?Category=${category}&StartDate=2010-01-01`,
    credentials
  );
  const data = (await response.json()) as UsageRecordsResponse;
  return sumUsageMinutes(data);
}

interface DkVoicePricing {
  inboundPricePerMinute: number;
  outboundPricePerMinute: number;
}

// Twilio's own current per-minute voice pricing for Denmark (Pricing API —
// a different host/base path than the rest of lib/twilio, hence not going
// through twilioFetch). Deliberately best-effort: returns null on anything
// unexpected (network failure, an unrecognized response shape) rather than
// throwing, since the calling code treats "no estimate" as an acceptable
// degraded state but a wrong estimate is not.
async function getDkVoicePricing(credentials: TwilioCredentials): Promise<DkVoicePricing | null> {
  try {
    const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64");
    const response = await fetch("https://pricing.twilio.com/v2/Voice/Countries/DK", {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      inbound_call_prices?: { number_type: string; current_price: string }[];
      outbound_prefix_prices?: { friendly_name: string; current_price: string }[];
    };

    const inboundPrice = data.inbound_call_prices?.find((p) => p.number_type === "local")?.current_price;
    // Multiple outbound bands exist for Denmark (landline vs. mobile) —
    // take the highest of whatever Danish bands are present so the
    // resulting "minutes remaining" estimate is a conservative floor, not
    // an optimistic ceiling that assumes every call lands on the cheapest
    // possible number.
    const outboundPrices = (data.outbound_prefix_prices ?? [])
      .filter((p) => p.friendly_name?.toLowerCase().includes("denmark"))
      .map((p) => parseFloat(p.current_price))
      .filter((price) => Number.isFinite(price) && price > 0);

    const inbound = inboundPrice ? parseFloat(inboundPrice) : NaN;
    const outbound = outboundPrices.length > 0 ? Math.max(...outboundPrices) : NaN;

    if (!Number.isFinite(inbound) || !Number.isFinite(outbound) || inbound <= 0 || outbound <= 0) return null;

    return { inboundPricePerMinute: inbound, outboundPricePerMinute: outbound };
  } catch {
    return null;
  }
}

// Live snapshot of a Twilio account's remaining call budget, split by
// direction — built for the BYO-Twilio "~75 min free trial" numbers (see
// app/dashboard/inbound/free-trial/page.tsx), whose credentials are stored
// directly on the phone_numbers row (0021_byo_twilio_direct.sql). Balance
// and used-minutes are Twilio's own authoritative figures; the "remaining"
// estimate is Twilio's balance divided by Twilio's own current per-minute
// price, so the only thing approximate about it is which of a call's
// actual number/destination it assumes — never a rate we made up.
export async function getTwilioCallMinutesSummary(credentials: TwilioCredentials): Promise<TwilioCallMinutesSummary> {
  const [balanceResponse, inboundMinutesUsed, outboundMinutesUsed, pricing] = await Promise.all([
    twilioFetch("/Balance.json", credentials),
    getUsageMinutes(credentials, "calls-inbound"),
    getUsageMinutes(credentials, "calls-outbound"),
    getDkVoicePricing(credentials),
  ]);

  const balanceData = (await balanceResponse.json()) as { balance: string; currency: string };
  const balance = parseFloat(balanceData.balance) || 0;

  return {
    balance,
    currency: (balanceData.currency || "usd").toUpperCase(),
    inboundMinutesUsed,
    outboundMinutesUsed,
    inboundMinutesRemaining: pricing && balance > 0 ? Math.floor(balance / pricing.inboundPricePerMinute) : null,
    outboundMinutesRemaining: pricing && balance > 0 ? Math.floor(balance / pricing.outboundPricePerMinute) : null,
  };
}
