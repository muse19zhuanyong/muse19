// Supabase 客户端（service_role），供 Edge Functions 使用
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getSb() {
  const url = Deno.env.get("MUSE19_SUPABASE_URL") ?? "";
  const key = Deno.env.get("MUSE19_SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    throw new Error("missing MUSE19_SUPABASE_URL / MUSE19_SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}
