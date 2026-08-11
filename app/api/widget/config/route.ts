import { NextResponse } from "next/server";
import { withErrorHandling, rateLimit, getClientIp } from "@/lib/security";
import { getWidgetBundleByPublicId, toPublicWidgetConfig } from "@/lib/widgets";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`widget-config:${ip}`, { limit: 120, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const { searchParams } = new URL(request.url);
  const publicId = searchParams.get("publicId");
  if (!publicId) throw ApiError.badRequest("publicId is required");

  const bundle = await getWidgetBundleByPublicId(publicId);
  if (!bundle) throw ApiError.notFound("Widget not found");

  return NextResponse.json({ config: toPublicWidgetConfig(bundle) });
});
