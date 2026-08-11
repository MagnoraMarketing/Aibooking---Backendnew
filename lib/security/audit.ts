import "server-only";
import { getAdminClient } from "@/lib/database/admin";

const SENSITIVE_KEY_PATTERN = /(key|secret|token|password|authorization)/i;

// Strips anything that looks like a credential before it ever reaches the
// audit_logs table, even if a caller accidentally includes it in metadata.
function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    clean[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }
  return clean;
}

export async function writeAuditLog(params: {
  actorId?: string | null;
  actorRole?: string | null;
  customerId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = getAdminClient();
    await supabase.from("audit_logs").insert({
      actor_id: params.actorId ?? null,
      actor_role: params.actorRole ?? null,
      customer_id: params.customerId ?? null,
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ? redact(params.metadata) : {},
    });
  } catch (err) {
    // Audit logging must never take down the primary request.
    console.error("Failed to write audit log:", err);
  }
}
