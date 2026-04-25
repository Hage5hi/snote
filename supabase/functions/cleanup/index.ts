import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPass(supabase: SupabaseClient, input: string): Promise<boolean> {
  const { data } = await supabase
    .from("admin_config")
    .select("pass_hash")
    .eq("id", 1)
    .maybeSingle();
  const storedHash = typeof data?.pass_hash === "string" ? data.pass_hash : "";
  if (storedHash) {
    try { return await bcrypt.compare(input, storedHash); } catch { return false; }
  }
  const expected = Deno.env.get("ADMIN_PASSPHRASE") ?? "";
  if (!expected) return false;
  return constantTimeEqual(input, expected);
}

// Deletes empty notes older than `olderThanHours` (default 1 hour).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const passphrase = String(body?.passphrase ?? "");
    const olderThanHours = Math.max(parseInt(body?.olderThanHours ?? "1", 10) || 1, 1);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const ok = await verifyPass(supabase, passphrase);
    if (!ok) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();

    const { error: e1, count: c1 } = await supabase
      .from("notes")
      .delete({ count: "exact" })
      .eq("is_encrypted", false)
      .eq("char_count", 0)
      .lt("created_at", cutoff);
    if (e1) throw e1;

    // Encrypted empties: char_count is always 0 for encrypted rows (the
    // provider zeroes it to stay zero-knowledge), so we can't use that as
    // the "empty" signal. Instead select candidates and filter by the
    // encoded ydoc_state length in JS. A Y.Doc with zero text but some
    // structure is ~40-80 chars of base64; >100 means the user actually
    // typed something.
    const { data: candidates, error: e2 } = await supabase
      .from("notes")
      .select("slug, ydoc_state")
      .eq("is_encrypted", true)
      .lt("created_at", cutoff)
      .limit(1000);
    if (e2) throw e2;
    const emptySlugs = (candidates ?? [])
      .filter((r) => (r.ydoc_state ?? "").length < 100)
      .map((r) => r.slug);
    let encryptedDeleted = 0;
    if (emptySlugs.length > 0) {
      const { error: e3, count: c3 } = await supabase
        .from("notes")
        .delete({ count: "exact" })
        .in("slug", emptySlugs);
      if (e3) throw e3;
      encryptedDeleted = c3 ?? emptySlugs.length;
    }

    const total = (c1 ?? 0) + encryptedDeleted;
    return new Response(JSON.stringify({ deleted: total, plaintext: c1 ?? 0, encrypted: encryptedDeleted, cutoff }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cleanup error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
