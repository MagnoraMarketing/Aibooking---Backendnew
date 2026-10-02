import type { Customer, CustomerType } from "@/types/database";

// Customer types (0049_customer_type_samarbejde.sql). "standard" is every
// normal paying tenant. "samarbejde" is a partnership/demo customer: a real
// tenant with its own agents, calls and statistics in admin, but never
// billed — no Stripe subscription, no auto-recharge, and an empty balance
// never takes its agents offline. Its usage is still written to the ledger,
// so the balance simply goes negative and shows what the partnership costs.
export const CUSTOMER_TYPES = ["standard", "samarbejde"] as const satisfies readonly CustomerType[];

export function isNotBilled(customer: Pick<Customer, "customer_type"> | null | undefined): boolean {
  return customer?.customer_type === "samarbejde";
}

// What checkAndRefillIfNeeded reports as the balance of a not-billed
// customer whose ledger is at or below zero, so every "balanceSeconds <= 0"
// gate lets the call through without each route knowing about types.
export const NOT_BILLED_BALANCE_SECONDS = 24 * 60 * 60;
