import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAvailability, createBooking } from "@/lib/vapi/booking-tools";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const receivedSecret = request.headers.get("x-vapi-secret");
  if (!isValidSecret(receivedSecret, webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { tool, input, customerId, widgetId, conversationId } = body as {
    tool?: string;
    input?: unknown;
    customerId?: string;
    widgetId?: string;
    conversationId?: string;
  };

  if (!tool || !customerId || !widgetId || !conversationId) {
    return NextResponse.json(
      { error: "Missing required fields: tool, customerId, widgetId, conversationId" },
      { status: 400 }
    );
  }

  const ctx = { customerId, widgetId, conversationId };

  try {
    let result: string;

    if (tool === "check_availability") {
      result = await checkAvailability(input as { date?: string } | undefined, ctx);
    } else if (tool === "create_booking") {
      result = await createBooking(
        input as { start_time?: string; customer_name?: string; customer_email?: string } | undefined,
        ctx
      );
    } else {
      return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err) {
    console.error(`Tool execution failed for ${tool}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
