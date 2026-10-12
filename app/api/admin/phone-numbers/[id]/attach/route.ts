import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { attachPhoneNumber, currentVapiAssistantId } from "@/lib/admin/widget-service";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const attachInputSchema = z.object({ widgetId: z.string().uuid() });

// "Tilknyt til agent" from /admin/phone-numbers (spec section 6) — points an
// already-provisioned Vapi number at a different widget/inbound agent's
// assistant. Works on a number that's currently idle or already attached
// elsewhere; the admin is explicitly choosing to move it.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const phoneNumberId = requireParam(params, "id");
  const { widgetId } = await readJsonBody(request, attachInputSchema);
  const supabase = getAdminClient();

  const { data: widget, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle();
  if (error) throw error;
  if (!widget) throw ApiError.notFound("Widget not found");

  const vapiAssistantId = await currentVapiAssistantId(widgetId);
  await attachPhoneNumber(phoneNumberId, widget as Widget, vapiAssistantId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "phone_number.attached_to_agent",
    entityType: "phone_number",
    entityId: phoneNumberId,
    metadata: { widgetId },
  });

  return NextResponse.json({ success: true });
});
