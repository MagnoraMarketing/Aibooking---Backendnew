import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import type { CreditTransaction, CreditTransactionType } from "@/types/database";

// The append-only ledger is the single source of truth for credit balance.
// Every mutation goes through the record_credit_transaction() Postgres
// function (service_role only) so the ledger row and the cached balance on
// credit_accounts always move together, atomically.
async function recordTransaction(params: {
  customerId: string;
  amountSeconds: number;
  type: CreditTransactionType;
  description?: string;
  usageSessionId?: string;
  stripeEventId?: string;
  createdBy?: string;
}): Promise<CreditTransaction> {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .rpc("record_credit_transaction", {
      p_customer_id: params.customerId,
      p_amount_seconds: params.amountSeconds,
      p_type: params.type,
      p_description: params.description ?? null,
      p_usage_session_id: params.usageSessionId ?? null,
      p_stripe_event_id: params.stripeEventId ?? null,
      p_created_by: params.createdBy ?? null,
    })
    .single();

  if (error) throw new Error(`Failed to record credit transaction: ${error.message}`);
  return data as CreditTransaction;
}

export async function getBalanceSeconds(customerId: string): Promise<number> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("credit_accounts")
    .select("balance_seconds")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read credit balance: ${error.message}`);
  return data?.balance_seconds ?? 0;
}

export async function grantCredits(params: {
  customerId: string;
  seconds: number;
  description: string;
  stripeEventId?: string;
}): Promise<CreditTransaction> {
  if (params.seconds <= 0) throw new Error("grantCredits requires a positive amount");
  return recordTransaction({
    customerId: params.customerId,
    amountSeconds: params.seconds,
    type: "subscription_credit",
    description: params.description,
    stripeEventId: params.stripeEventId,
  });
}

export async function deductUsage(params: {
  customerId: string;
  seconds: number;
  usageSessionId: string;
  description?: string;
}): Promise<CreditTransaction> {
  if (params.seconds <= 0) throw new Error("deductUsage requires a positive amount");
  return recordTransaction({
    customerId: params.customerId,
    amountSeconds: -params.seconds,
    type: "usage",
    description: params.description ?? "Voice session usage",
    usageSessionId: params.usageSessionId,
  });
}

export async function manualAdjustment(params: {
  customerId: string;
  seconds: number; // positive to add, negative to remove
  description: string;
  createdBy: string;
}): Promise<CreditTransaction> {
  return recordTransaction({
    customerId: params.customerId,
    amountSeconds: params.seconds,
    type: "manual_adjustment",
    description: params.description,
    createdBy: params.createdBy,
  });
}

export async function refundCredits(params: {
  customerId: string;
  seconds: number;
  description: string;
  usageSessionId?: string;
}): Promise<CreditTransaction> {
  if (params.seconds <= 0) throw new Error("refundCredits requires a positive amount");
  return recordTransaction({
    customerId: params.customerId,
    amountSeconds: params.seconds,
    type: "refund",
    description: params.description,
    usageSessionId: params.usageSessionId,
  });
}

export async function expireCredits(params: {
  customerId: string;
  seconds: number; // positive amount that expires (will be recorded as negative)
  description: string;
}): Promise<CreditTransaction> {
  if (params.seconds <= 0) throw new Error("expireCredits requires a positive amount");
  return recordTransaction({
    customerId: params.customerId,
    amountSeconds: -params.seconds,
    type: "expiration",
    description: params.description,
  });
}

export async function listTransactions(customerId: string, limit = 100) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list credit transactions: ${error.message}`);
  return data as CreditTransaction[];
}
