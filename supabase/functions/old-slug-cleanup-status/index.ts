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

  const startedAt = Date.now();
  let slug = "";
  let newSlug: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    newSlug = typeof body?.newSlug === "string" ? body.newSlug.trim() : undefined;
    if (!SLUG_RE.test(slug)) {
      console.warn("[cleanup-status] invalid_slug", { slug, durationMs: Date.now() - startedAt });
      return json({ error: "invalid slug" }, 400);
    }

    const clientSignals = body?.clientSignals && typeof body.clientSignals === "object"
      ? body.clientSignals
      : {};
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const dbStart = Date.now();
    const { data, error } = await supabase
      .from("notes")
      .select("slug, char_count, updated_at, ydoc_state, content")
      .eq("slug", slug)
      .maybeSingle();
    const dbMs = Date.now() - dbStart;
    if (error) {
      console.error("[cleanup-status] db_error", { oldSlug: slug, newSlug, dbMs, error: error.message });
      return json({ error: error.message }, 500);
    }

    const row = snapshot(data);
    const cleaned = !row &&
      clientSignals.providerAbandoned === true &&
      clientSignals.docCacheWarm !== true &&
      clientSignals.sessionSnapshotPresent !== true;

    const totalMs = Date.now() - startedAt;
    const logPayload = {
      oldSlug: slug,
      newSlug,
      cleaned,
      rowPresent: !!row,
      providerAbandoned: clientSignals.providerAbandoned === true,
      docCacheWarm: clientSignals.docCacheWarm === true,
      sessionSnapshotPresent: clientSignals.sessionSnapshotPresent === true,
      indexedDbCleared: clientSignals.indexedDbCleared === true,
      dbMs,
      totalMs,
    };
    // Warn when the response is slow or when the row is still present past a
    // reasonable cleanup window so CI logs surface it clearly.
    if (!cleaned || totalMs > 1_500) console.warn("[cleanup-status] slow_or_dirty", logPayload);
    else console.log("[cleanup-status] ok", logPayload);

    return json({
      slug,
      source: "edge-function",
      database: { rowPresent: !!row, row },
      clientSignals,
      cleaned,
      metrics: { dbMs, totalMs },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cleanup-status] unhandled", { oldSlug: slug, newSlug, durationMs: Date.now() - startedAt, error: msg });
    return json({ error: msg }, 500);
  }
});