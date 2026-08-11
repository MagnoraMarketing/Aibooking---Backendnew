#!/usr/bin/env node
/**
 * Secure, one-time bootstrap for the first MASTER_ADMIN account.
 *
 * There is no HTTP endpoint that can create a MASTER_ADMIN — that's
 * intentional (see spec section 28: "Det må ikke være muligt for
 * almindelige brugere at registrere sig som admin"). This script must be
 * run manually by an operator who already holds the Supabase service role
 * key, e.g.:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *   MASTER_ADMIN_EMAIL=you@aibooking.dk MASTER_ADMIN_PASSWORD=... \
 *   node scripts/create-master-admin.mjs
 *
 * or `npm run create-master-admin` after populating .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function loadDotEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.MASTER_ADMIN_EMAIL;
const password = process.env.MASTER_ADMIN_PASSWORD;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!email || !password) {
  console.error("Missing MASTER_ADMIN_EMAIL or MASTER_ADMIN_PASSWORD.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("MASTER_ADMIN_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existingProfiles, error: existingError } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "MASTER_ADMIN")
    .limit(1);

  if (existingError) {
    console.error("Failed to check for an existing master admin:", existingError.message);
    process.exit(1);
  }

  if (existingProfiles && existingProfiles.length > 0) {
    console.error(
      "A MASTER_ADMIN already exists. Refusing to create another one via this script — " +
        "use the admin dashboard, or delete the existing profile first if this is intentional."
    );
    process.exit(1);
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    console.error("Failed to create the auth user:", createError?.message);
    process.exit(1);
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: created.user.id,
    role: "MASTER_ADMIN",
    customer_id: null,
    full_name: "AIbooking Master Admin",
  });

  if (profileError) {
    console.error("User was created but the profile insert failed:", profileError.message);
    console.error(`You may need to manually insert a profiles row for auth user id ${created.user.id}.`);
    process.exit(1);
  }

  console.log(`Master admin created: ${email}`);
}

main();
