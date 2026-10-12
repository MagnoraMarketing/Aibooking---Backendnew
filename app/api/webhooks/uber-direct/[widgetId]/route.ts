import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { writeAuditLog } from "@/lib/security";
import { resolveUberDirectConfig } from "@/lib/uber-direct/connection";

// Every route here is per-request — never statically optimized/cached.
export const dynamic = "force-dynamic";

// Uber Direct delivery status / courier updates for one agent. The URL
// carries the widget id because every agent has its own Uber account and
// its own webhook signing key, set up in Uber's dashboard with this URL.
//
// Uber signs the raw body with HMAC-SHA256 (hex) using that signing key, in
// x-uber-signature (x-postmates-signature on older setups). The body must be
// verified exactly as sent — re-serializing the JSON would break it.
function isValidSignature(rawBody: string, received: string | null, secret: string): boolean {
  if (!received) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const receivedBuf = Buffer.from(received.trim().toLowerCase(), "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

export async function POST(request: Request, { params }: { params: { widgetId: string } }): Promise<NextResponse> {
  const widgetId = params.widgetId;
  const supabase = getAdminClient();

  const [{ data: widget }, { data: settings }] = await Promise.all([
    supabase.from("widgets").select("id, customer_id").eq("id", widgetId).maybeSingle(),
    supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle(),
  ]);
  const config = resolveUberDirectConfig((settings?.extra as Record<string, unknown> | null) ?? null);

  // Nothing to verify against means nothing may be trusted or written.
  if (!widget || !config?.webhookSigningKey) {
    return NextResponse.json({ received: false, reason: "not_configured" }, { status: 202 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-uber-signature") ?? request.headers.get("x-postmates-signature");
  if (!isValidSignature(rawBody, signature, config.webhookSigningKey)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const deliveryId =
    (typeof payload.delivery_id === "string" && payload.delivery_id) ||
    (typeof data.id === "string" && data.id) ||
    null;

  if (deliveryId) {
    const courier = (data.courier ?? null) as Record<string, unknown> | null;
    await writeAuditLog({
      customerId: widget.customer_id as string,
      action: "uber_direct.delivery_status",
      entityType: "uber_delivery",
      entityId: deliveryId,
      metadata: {
        widgetId,
        kind: typeof payload.kind === "string" ? payload.kind : null,
        status: typeof payload.status === "string" ? payload.status : (data.status ?? null),
        trackingUrl: typeof data.tracking_url === "string" ? data.tracking_url : null,
        dropoffEta: typeof data.dropoff_eta === "string" ? data.dropoff_eta : null,
        courierName: courier && typeof courier.name === "string" ? courier.name : null,
      },
    });
  }

  return NextResponse.json({ received: true });
}
