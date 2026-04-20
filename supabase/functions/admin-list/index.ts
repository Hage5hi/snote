import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
    const search = typeof body?.search === "string" ? body.search.trim() : "";
    const limit = Math.min(Math.max(parseInt(body?.limit ?? "100", 10) || 100, 1), 500);
    const offset = Math.max(parseInt(body?.offset ?? "0", 10) || 0, 0);

    const expected = Deno.env.get("ADMIN_PASSPHRASE") ?? "";
    if (!expected || !constantTimeEqual(passphrase, expected)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let query = supabase
      .from("notes")
      .select("slug, char_count, is_encrypted, updated_at, created_at, content", {
        count: "exact",
      })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      // Match on slug or (plaintext) content.
      query = query.or(`slug.ilike.%${search}%,content.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = (data ?? []).map((r) => ({
      slug: r.slug,
      char_count: r.char_count,
      is_encrypted: r.is_encrypted,
      updated_at: r.updated_at,
      created_at: r.created_at,
      preview: r.is_encrypted ? "🔒 encrypted" : (r.content ?? "").slice(0, 200),
    }));

    return new Response(JSON.stringify({ items, total: count ?? items.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-list error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
