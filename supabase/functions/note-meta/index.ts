// Public endpoint trả về metadata cho 1 note (slug). Dùng bởi Cloudflare
// Worker để render HTML với og/twitter/canonical tags cho crawler không-JS.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug")?.trim() ?? "";
    const token = url.searchParams.get("token")?.trim() ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let resolvedSlug = slug;
    if (!resolvedSlug && token) {
      const { data: share } = await supabase
        .from("note_shares")
        .select("slug")
        .eq("token", token)
        .maybeSingle();
      if (!share) {
        return new Response(JSON.stringify({ found: false }), {
          status: 404,
          headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
      resolvedSlug = share.slug;
    }

    if (!SLUG_RE.test(resolvedSlug)) {
      return new Response(JSON.stringify({ found: false }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const { data: note } = await supabase
      .from("notes")
      .select("slug, is_encrypted, content, char_count, tags, updated_at")
      .eq("slug", resolvedSlug)
      .maybeSingle();

    if (!note) {
      return new Response(
        JSON.stringify({ found: false, slug: resolvedSlug }),
        { status: 404, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    // Lấy snippet sạch (~160 ký tự) chỉ khi không mã hoá
    let snippet: string | null = null;
    if (!note.is_encrypted && note.content) {
      const plain = String(note.content)
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#>*_`~\[\]()!-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      snippet = plain.length > 160 ? plain.slice(0, 157) + "…" : plain;
    }

    return new Response(
      JSON.stringify({
        found: true,
        slug: note.slug,
        isEncrypted: note.is_encrypted,
        snippet,
        charCount: note.char_count,
        tags: note.tags ?? [],
        updatedAt: note.updated_at,
      }),
      {
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
          "cache-control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
