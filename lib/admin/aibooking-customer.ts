import "server-only";
import { getAdminClient } from "@/lib/database/admin";

// The reserved, non-billed customer row that owns AIbooking's own website
// widget(s) — seeded by 0043_admin_wapi_control_center.sql. Looked up by the
// is_platform_owned flag rather than a hardcoded id/email so it survives a
// re-seed on a fresh database. Creates it on the fly if the seed somehow
// never ran (e.g. a database restored from before this migration), so the
// "AIbooking website" deployment option never hard-fails.
export async function getOrCreateAibookingCustomerId(): Promise<string> {
  const supabase = getAdminClient();

  const { data: existing, error } = await supabase
    .from("customers")
    .select("id")
    .eq("is_platform_owned", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing.id as string;

  const { data: created, error: createError } = await supabase
    .from("customers")
    .insert({
      name: "AIbooking.dk (egen widget)",
      email: "internal-aibooking-website@aibooking.dk",
      status: "active",
      is_platform_owned: true,
    })
    .select("id")
    .single();
  if (createError) throw createError;
  return created.id as string;
}
