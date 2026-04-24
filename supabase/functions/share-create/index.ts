import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function generateToken(): string {
  // 18 random bytes → 24 chars base64url (no padding).
  const buf = new Uint8Array(18);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

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
    const slug = String(body?.slug ?? "").trim();
    if (!SLUG_RE.test(slug)) return json({ error: "invalid slug" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: note } = await supabase
      .from("notes")
      .select("slug")
      .eq("slug", slug)
      .maybeSingle();
    if (!note) return json({ error: "note not found" }, 404);

    // "One link per slug" contract: drop the previous token before inserting
    // the new one so a user re-generating always ends up with exactly one
    // active share link. Last-write-wins if two tabs race.
    await supabase.from("note_shares").delete().eq("slug", slug);

    let token = "";
    let lastErr: unknown = null;
    for (let i = 0; i < 5; i++) {
      token = generateToken();
      const { error } = await supabase.from("note_shares").insert({ token, slug });
      if (!error) { lastErr = null; break; }
      lastErr = error;
    }
    if (lastErr) throw lastErr;

    return json({ token }, 200);
  } catch (e) {
    console.error("share-create error", e);
    return json({ error: String(e) }, 500);
  }
});
