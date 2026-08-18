import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, calendarOAuthConnectQuerySchema } from "@/lib/security";
import { buildOutlookAuthUrl, buildOAuthState, cookieNameForProvider } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Kicks off the Outlook/Microsoft 365 OAuth flow for one widget — mirrors
// the Google connect route (see app/api/customer/calendar/google/connect).
export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const { searchParams } = new URL(request.url);
  const parsed = calendarOAuthConnectQuerySchema.safeParse({ widgetId: searchParams.get("widgetId") });
  if (!parsed.success) throw ApiError.badRequest("Missing or invalid widgetId");
  const { widgetId } = parsed.data;

  const supabase = getAdminClient();
  const { data: widget, error } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", widgetId)
    .maybeSingle();
  if (error) throw error;
  if (!widget || widget.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Widget not found");

  const { state, nonce } = buildOAuthState(widgetId);
  cookies().set(cookieNameForProvider("outlook"), nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildOutlookAuthUrl(state));
});
