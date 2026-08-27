import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getSummarizationModelName } from "@/lib/settings/platform";
import { getAdminClient } from "@/lib/database/admin";

// Diagnostic endpoint - remove after testing
export async function GET() {
  try {
    const ctx = await requireCustomerAdmin();
    const model = await getSummarizationModelName();

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("key, value")
      .eq("key", "summarization_model_name")
      .maybeSingle();

    return NextResponse.json({
      success: true,
      model,
      dbData: data,
      dbError: error ? error.message : null,
      customerId: ctx.profile.customer_id,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
