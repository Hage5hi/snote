import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function snapshot(row: {
  slug: string;
  char_count: number | null;
  updated_at?: string | null;
  ydoc_state?: string | null;
  content?: string | null;
} | null) {
  if (!row) return null;
  return {
    slug: row.slug,
    char_count: row.char_count ?? null,
    updated_at: row.updated_at ?? null,
    ydoc_state_len: (row.ydoc_state ?? "").length,
    content_len: (row.content ?? "").length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    if (!SLUG_RE.test(slug)) return json({ error: "invalid slug" }, 400);

    const clientSignals = body?.clientSignals && typeof body.clientSignals === "object"
      ? body.clientSignals
      : {};
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("notes")
      .select("slug, char_count, updated_at, ydoc_state, content")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);

    const row = snapshot(data);
    const cleaned = !row &&
      clientSignals.providerAbandoned === true &&
      clientSignals.docCacheWarm !== true &&
      clientSignals.sessionSnapshotPresent !== true;

    return json({
      slug,
      source: "edge-function",
      database: { rowPresent: !!row, row },
      clientSignals,
      cleaned,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});