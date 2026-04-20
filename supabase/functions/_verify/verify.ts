// Shared passphrase verification helper for admin edge functions.
// Note: Deno deploy bundles each function independently, so we duplicate
// this logic via direct import paths inside each function.
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassphrase(
  supabase: SupabaseClient,
  input: string,
): Promise<boolean> {
  // 1. Try DB-stored hash first.
  const { data } = await supabase
    .from("admin_config")
    .select("pass_hash")
    .eq("id", 1)
    .maybeSingle();

  if (data?.pass_hash) {
    try {
      return await bcrypt.compare(input, data.pass_hash);
    } catch {
      return false;
    }
  }

  // 2. Fallback to env secret (bootstrap / disaster recovery).
  const expected = Deno.env.get("ADMIN_PASSPHRASE") ?? "";
  if (!expected) return false;
  return constantTimeEqual(input, expected);
}
