import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { writeAuditLog } from "@/lib/security";
import { justEatWebhookToken } from "@/lib/just-eat/connection";

// Every route here is per-request — never statically optimized/cached.
export const dynamic = "force-dynamic";

// Just Eat (JET Go) delivery status updates for one agent. JET Go posts a
// webhook at each step (courier assigned, collected, delivered, …). Its
// signing scheme isn't public, so the URL set up in Just Eat's partner portal
// carries a per-agent secret token we generated (lib/just-eat/connection.ts);
// without a match nothing is trusted or written.

function tokenMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export async function POST(request: Request, { params }: { params: { widgetId: string } }): Promise<NextResponse> {
  const widgetId = params.widgetId;
  const supabase = getAdminClient();

  const [{ data: widget }, { data: settings }] = await Promise.all([
    supabase.from("widgets").select("id, customer_id").eq("id", widgetId).maybeSingle(),
    supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle(),
  ]);
  const expected = justEatWebhookToken((settings?.extra as Record<string, unknown> | null) ?? null);
  if (!widget || !expected) {
    return NextResponse.json({ received: false, reason: "not_configured" }, { status: 202 });
  }

  const received = new URL(request.url).searchParams.get("token") ?? request.headers.get("x-webhook-token");
  if (!tokenMatches(received, expected)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Read defensively: the payload's exact shape comes with partner access.
  const data = ((payload.data ?? payload.delivery ?? payload) as Record<string, unknown>) ?? {};
  const deliveryId = pick(data, ["deliveryId", "id", "requestId"]) ?? pick(payload, ["deliveryId", "requestId"]);
  const courier = (data.courier ?? data.driver ?? null) as Record<string, unknown> | null;

  if (deliveryId) {
    await writeAuditLog({
      customerId: widget.customer_id as string,
      action: "just_eat.delivery_status",
      entityType: "just_eat_delivery",
      entityId: deliveryId,
      metadata: {
        widgetId,
        event: pick(payload, ["event", "type", "eventType"]),
        status: pick(data, ["status", "state"]) ?? pick(payload, ["status", "state"]),
        deliverEta: pick(data, ["estimatedDeliverTime", "estimatedDeliveryTime", "deliverTime"]),
        trackingUrl: pick(data, ["trackingUrl", "tracking_url", "trackingLink"]),
        courierName: courier ? pick(courier, ["name", "firstName"]) : null,
      },
    });
  }

  return NextResponse.json({ received: true });
}
