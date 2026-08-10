import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { onboardCustomer } from "@/lib/customers/onboarding";
import { readJsonBody, withErrorHandling, writeAuditLog, createCustomerSchema } from "@/lib/security";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return NextResponse.json({ customers: data });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, createCustomerSchema);

  const result = await onboardCustomer({
    name: body.name,
    email: body.email,
    packageId: body.packageId,
    llmModelId: body.llmModelId,
    voiceModelId: body.voiceModelId,
    businessName: body.businessName,
    sendInvitation: body.sendInvitation,
  });

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: result.customer.id,
    action: "customer.created",
    entityType: "customer",
    entityId: result.customer.id,
    metadata: { invitationSent: result.invitationSent },
  });

  return NextResponse.json(
    {
      customer: result.customer,
      widget: {
        ...result.widget,
        shareUrl: buildShareUrl(result.widget.public_id),
        embedSnippet: buildEmbedSnippet(result.widget.public_id),
      },
      invitationSent: result.invitationSent,
    },
    { status: 201 }
  );
});
