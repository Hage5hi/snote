import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
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

async function verifyPass(supabase: any, input: string): Promise<boolean> {
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
    const slugs: unknown = body?.slugs;
    const all = body?.all === true;

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

    if (all) {
      const { error, count } = await supabase
        .from("notes")
        .delete({ count: "exact" })
        .gte("created_at", "1970-01-01");
      if (error) throw error;
      return new Response(JSON.stringify({ deleted: count ?? 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(slugs) || slugs.length === 0) {
      return new Response(JSON.stringify({ error: "slugs[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleaned = slugs.filter((s): s is string => typeof s === "string");
    const { error, count } = await supabase
      .from("notes")
      .delete({ count: "exact" })
      .in("slug", cleaned);
    if (error) throw error;

    return new Response(JSON.stringify({ deleted: count ?? 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-delete error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
