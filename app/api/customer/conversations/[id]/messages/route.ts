import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";
import { loadStoredCallReport } from "@/lib/vapi/stored-call-report";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (convError) throw convError;
  if (!conversation || conversation.customer_id !== ctx.profile.customer_id) {
    throw ApiError.notFound("Conversation not found");
  }

  const [{ data: messages, error: messagesError }, { data: widget }, { data: summaries }] = await Promise.all([
    supabase
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: true }),
    supabase.from("widgets").select("name").eq("id", conversation.widget_id).maybeSingle(),
    supabase
      .from("conversation_summaries")
      .select("*")
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (messagesError) throw messagesError;

  // Everything the details modal shows for a voice conversation comes from
  // the call's end-of-call-report — see lib/vapi/call-report.ts.
  const call = await loadStoredCallReport(supabase, conversation.vapi_call_id);

  return NextResponse.json({
    conversation,
    widgetName: widget?.name ?? null,
    messages,
    // A voice conversation has no rows in conversation_messages — nothing on
    // our side is on the line to write them. Its turns come from the
    // end-of-call-report instead.
    transcript: call?.transcript ?? [],
    recordingUrl: call?.recordingUrl ?? null,
    summary: summaries?.[0]?.summary ?? call?.summary ?? null,
  });
});
