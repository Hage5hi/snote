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
    const tag = typeof body?.tag === "string" ? body.tag.trim().toLowerCase() : "";
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
      .select("slug, char_count, is_encrypted, updated_at, created_at, content, tags", {
        count: "exact",
      })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      // Sanitize: strip characters that could break PostgREST .or() syntax
      // ( , ) parentheses/comma are filter separators; % _ are SQL wildcards;
      // * and " can confuse the parser. Keep alphanumerics, spaces, dashes, dots.
      const safe = search.replace(/[%_,()"*\\]/g, "").slice(0, 100);
      if (safe) {
        query = query.or(`slug.ilike.%${safe}%,content.ilike.%${safe}%`);
      }
    }

    if (tag) {
      // Sanitize tag — only allow alphanumerics, dash, underscore.
      const safeTag = tag.replace(/[^a-z0-9_-]/g, "").slice(0, 32);
      if (safeTag) query = query.contains("tags", [safeTag]);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = (data ?? []).map((r) => ({
      slug: r.slug,
      char_count: r.char_count,
      is_encrypted: r.is_encrypted,
      updated_at: r.updated_at,
      created_at: r.created_at,
      tags: r.tags ?? [],
      preview: r.is_encrypted ? "🔒 encrypted" : (r.content ?? "").slice(0, 200),
    }));

    // Aggregate top tags from this page (lightweight — full aggregation would
    // need a separate query; this is good enough for the picker UX).
    const tagCount = new Map<string, number>();
    for (const it of items) {
      for (const t of it.tags as string[]) {
        tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      }
    }
    const topTags = [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count }));

    return new Response(
      JSON.stringify({ items, total: count ?? items.length, topTags }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("admin-list error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
