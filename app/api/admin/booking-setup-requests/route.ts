import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog } from "@/lib/security";
import { ApiError } from "@/types/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSetupRequestSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  notes: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  let query = supabase.from("booking_setup_requests").select("*").order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ requests: data });
});

export const PATCH = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, z.object({ id: z.string().uuid(), ...updateSetupRequestSchema.shape }));
  const supabase = getAdminClient();

  // Mark request as started if transitioning to in_progress
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    status: body.status,
    updated_at: now,
  };

  if (body.status === "in_progress") {
    updateData.started_at = now;
    updateData.assigned_to = body.assignedTo || ctx.userId;
  } else if (body.status === "completed") {
    updateData.completed_at = now;
  }

  if (body.notes) {
    updateData.notes = body.notes;
  }

  const { data: setupRequest, error } = await supabase
    .from("booking_setup_requests")
    .update(updateData)
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) throw error;

  // If completed, update widget settings
  if (body.status === "completed") {
    await supabase
      .from("widget_settings")
      .update({
        booking_setup_status: "completed",
        booking_setup_completed_at: now,
      })
      .eq("widget_id", setupRequest.widget_id);

    await supabase
      .from("widgets")
      .update({ booking_enabled: true })
      .eq("id", setupRequest.widget_id);
  }

  if (body.status === "cancelled") {
    await supabase
      .from("widget_settings")
      .update({
        booking_setup_status: "failed",
        booking_setup_error: body.notes || null,
      })
      .eq("widget_id", setupRequest.widget_id);
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: setupRequest.customer_id,
    action: "booking_setup.updated",
    entityType: "widget",
    entityId: setupRequest.widget_id,
    metadata: { request_id: setupRequest.id, status: body.status },
  });

  return NextResponse.json({ request: setupRequest });
});
