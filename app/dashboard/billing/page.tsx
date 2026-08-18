import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { getBalanceSeconds } from "@/lib/credits";
import { isWithinTrial, trialDaysRemaining, TRIAL_MINUTES } from "@/lib/billing";
import { BillingManager } from "@/components/dashboard/billing-manager";
import type { Customer, Package, Subscription } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: customer }, { data: subscription }, balanceSeconds, { data: availablePackages }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customerId).single<Customer>(),
    supabase
      .from("subscriptions")
      .select("*, packages(*)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Subscription & { packages: Package | null }>(),
    getBalanceSeconds(customerId),
    supabase.from("packages").select("*").eq("active", true).order("monthly_price", { ascending: true }).returns<Package[]>(),
  ]);

  return (
    <BillingManager
      hasStripeCustomer={Boolean(customer?.stripe_customer_id)}
      subscription={subscription ?? null}
      currentPackage={subscription?.packages ?? null}
      balanceSeconds={balanceSeconds}
      availablePackages={availablePackages ?? []}
      isWithinTrial={customer ? isWithinTrial(customer.created_at) : false}
      trialDaysRemaining={customer ? trialDaysRemaining(customer.created_at) : 0}
      trialMinutes={TRIAL_MINUTES}
    />
  );
}
