import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "").trim();
    if (!TOKEN_RE.test(token)) return json({ error: "invalid token" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: share } = await supabase
      .from("note_shares")
      .select("slug")
      .eq("token", token)
      .maybeSingle();
    // Same 404 whether the token doesn't exist or the note was deleted, so the
    // viewer can't distinguish "never existed" from "revoked".
    if (!share) return json({ error: "not found" }, 404);

    const { data: note, error } = await supabase
      .from("notes")
      .select("content, ydoc_state, is_encrypted, enc_salt, enc_check, enc_iterations, updated_at")
      .eq("slug", share.slug)
      .maybeSingle();
    if (error || !note) return json({ error: "not found" }, 404);

    // IMPORTANT: do NOT include `slug` in the response. The whole point of
    // the share link is that the viewer never learns the underlying slug
    // (which would grant them edit access).
    return json({
      content: note.content,
      ydoc_state: note.ydoc_state,
      is_encrypted: note.is_encrypted,
      enc_salt: note.enc_salt,
      enc_check: note.enc_check,
      enc_iterations: note.enc_iterations,
      updated_at: note.updated_at,
    }, 200);
  } catch {
    // Do not echo or log errors that may contain the supplied share token.
    return json({ error: "temporarily unavailable" }, 503);
  }
});
