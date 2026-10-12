import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { readJsonBody, withErrorHandling, calcomEventTypesLookupSchema } from "@/lib/security";
import { fetchCalcomMe, fetchCalcomEventTypes } from "@/lib/calendar";

export const dynamic = "force-dynamic";

// Lets the admin Voice Widget / Inbound creation modal offer the same
// "pick an event type from a list" experience the customer dashboard has
// (components/dashboard/calendar-integrations-manager.tsx), instead of
// making the admin already know the numeric id. Read-only: proves the key
// works and lists what it can book against, nothing is persisted here —
// see connectAdminCalcom in lib/admin/widget-service.ts for the actual
// connect step that runs on save.
export const POST = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const { apiKey } = await readJsonBody(request, calcomEventTypesLookupSchema);

  const [account, eventTypes] = await Promise.all([fetchCalcomMe(apiKey), fetchCalcomEventTypes(apiKey)]);

  return NextResponse.json({ account, eventTypes });
});
