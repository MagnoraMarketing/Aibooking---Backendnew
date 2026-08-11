import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

// Anon-key client for use in client components (e.g. the customer login
// form). Never bundle the service role key here.
export function getBrowserClient() {
  return createBrowserClient(supabaseEnv.url, supabaseEnv.anonKey);
}
