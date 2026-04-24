// Migrate active share tokens from one slug to another.
//
// Called by renameNote(). The notes table is renamed by copy+delete, and the
// FK on note_shares(slug) is ON DELETE CASCADE, so the delete would otherwise
// wipe every share link for that note. This function runs BEFORE the delete
// and re-points the share rows to the new slug so active links keep working.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const oldSlug = String(body?.oldSlug ?? "").trim();
    const newSlug = String(body?.newSlug ?? "").trim();
    if (!SLUG_RE.test(oldSlug) || !SLUG_RE.test(newSlug)) {
      return json({ error: "invalid slug" }, 400);
    }
    if (oldSlug === newSlug) return json({ migrated: 0 }, 200);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("note_shares")
      .update({ slug: newSlug })
      .eq("slug", oldSlug)
      .select("token");
    if (error) throw error;

    return json({ migrated: data?.length ?? 0 }, 200);
  } catch (e) {
    console.error("share-rename error", e);
    return json({ error: String(e) }, 500);
  }
});
