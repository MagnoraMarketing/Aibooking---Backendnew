import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { getBalanceSeconds, listTransactions } from "@/lib/credits";
import { isWithinTrial, trialDaysRemaining } from "@/lib/billing";
import { getCustomerTrialMinutes } from "@/lib/settings/platform";
import { BillingManager } from "@/components/dashboard/billing-manager";
import type { Customer, Package, Subscription } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: customer }, { data: subscription }, balanceSeconds, { data: availablePackages }, transactions, trialMinutes] =
    await Promise.all([
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
      listTransactions(customerId, 10),
      // The minutes this customer was actually given, not today's setting.
      getCustomerTrialMinutes(customerId),
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
      trialMinutes={trialMinutes}
      transactions={transactions.map((t) => ({
        id: t.id,
        description: t.description,
        amountSeconds: t.amount_seconds,
        createdAt: t.created_at,
      }))}
    />
  );
}
