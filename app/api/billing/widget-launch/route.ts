import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp } from "@/lib/security";
import { buildWidgetLaunchUrl, WIDGET_LAUNCH_MINUTES } from "@/lib/billing";
import { ApiError } from "@/types/errors";
import type { Customer } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  widgetId: z.string().uuid().optional(),
});

// Hands the wizard's payment step the Stripe Payment Link to send the
// customer to. The link itself is public, but the client_reference_id that
// decides *who gets the 200 minutes* is built here from the session — never
// from anything the browser sends — so a customer can't buy minutes onto
// someone else's account (see lib/billing/widget-launch.ts).
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;

  const rateLimitResult = rateLimit(`billing-widget-launch:${getClientIp(request.headers)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const { widgetId } = await readJsonBody(request, bodySchema);

  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle<Customer>();
  if (!customer) throw ApiError.notFound("Customer not found");

  // Same 404-for-someone-else's-widget shape the other customer routes use —
  // the id only ever rides along so the return page can reopen the right
  // agent, but an unowned one must not be echoed back as valid.
  if (widgetId) {
    const { data: widget } = await supabase
      .from("widgets")
      .select("id, customer_id")
      .eq("id", widgetId)
      .maybeSingle();
    if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  }

  return NextResponse.json({
    url: buildWidgetLaunchUrl({ customerId, widgetId: widgetId ?? null, email: customer.email }),
    minutes: WIDGET_LAUNCH_MINUTES,
    alreadyPaid: Boolean(customer.widget_launch_paid_at),
  });
});
