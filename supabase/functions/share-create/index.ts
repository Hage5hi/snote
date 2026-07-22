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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug ?? "").trim();
    if (!SLUG_RE.test(slug)) return json({ error: "invalid slug" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "temporarily unavailable" }, 503);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Ensure the notes row exists. The client-side provider fires an
    // unawaited upsert when a fresh slug is opened (provider.ts), but that
    // can race with a fast user clicking "Generate share link", or fail
    // silently if the request is cancelled mid-flight. This is a legacy
    // compatibility step only; slug-as-key is not authorization and this
    // direct-table model is removed by the capability cutover.
    const { error: ensureErr } = await supabase
      .from("notes")
      .upsert({ slug }, { onConflict: "slug", ignoreDuplicates: true });
    if (ensureErr) return json({ error: "temporarily unavailable" }, 503);

    // "One link per slug" contract, enforced atomically via UNIQUE(slug) +
    // UPSERT onConflict=slug. A brand-new slug inserts; an existing slug
    // has its token/created_at replaced. Two concurrent callers cannot
    // both win and leave an orphan row — one request updates the row and
    // the other updates it back; exactly one token survives.
    let token = "";
    let lastErr: unknown = null;
    for (let i = 0; i < 5; i++) {
      token = generateToken();
      const { error } = await supabase
        .from("note_shares")
        .upsert(
          { token, slug, created_at: new Date().toISOString() },
          { onConflict: "slug" },
        );
      if (!error) { lastErr = null; break; }
      // Retry on the astronomically unlikely token PK collision (would
      // appear as unique_violation on the token PK, not the slug).
      lastErr = error;
    }
    if (lastErr) return json({ error: "temporarily unavailable" }, 503);

    return json({ token }, 200);
  } catch {
    return json({ error: "temporarily unavailable" }, 503);
  }
});
