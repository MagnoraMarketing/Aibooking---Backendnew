import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, checkoutRequestSchema } from "@/lib/security";
import { createCheckoutSession } from "@/lib/billing";
import { ApiError } from "@/types/errors";
import type { Package } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, checkoutRequestSchema);
  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", ctx.profile.customer_id!)
    .single();

  if (!customer) throw ApiError.notFound("Customer not found");

  let pkg: Package | null = null;
  if (body.packageId) {
    const { data } = await supabase.from("packages").select("*").eq("id", body.packageId).eq("active", true).maybeSingle();
    pkg = data;
  } else {
    const { data } = await supabase
      .from("packages")
      .select("*")
      .eq("active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    pkg = data;
  }

  if (!pkg) throw ApiError.badRequest("No package available for checkout");

  const { url } = await createCheckoutSession({ customer, pkg });
  return NextResponse.json({ url });
});
