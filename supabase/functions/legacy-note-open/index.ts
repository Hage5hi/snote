import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";

const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REQUEST_BYTES = 256;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: "invalid request" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "temporarily unavailable" }, 503);

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "invalid request" }, 400);
    }
    const body = JSON.parse(raw) as { action?: unknown; slug?: unknown };
    if (!SLUG_RE.test(String(body.slug ?? "")) || !["exists", "open"].includes(String(body.action))) {
      return json({ error: "invalid request" }, 400);
    }
    const slug = String(body.slug);
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.action === "exists") {
      const { data, error } = await client
        .from("notes")
        .select("slug")
        .eq("slug", slug)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return json({ error: "temporarily unavailable" }, 503);
      return json({ exists: !!data, note: null });
    }

    const { data, error } = await client
      .from("notes")
      .select("slug, content, ydoc_state, is_encrypted, enc_salt, enc_check, enc_iterations")
      .eq("slug", slug)
      .eq("capability_managed", false)
      .eq("sync_status", "legacy")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return json({ error: "temporarily unavailable" }, 503);
    if (!data) return json({ exists: false, note: null });

    return json({
      exists: true,
      note: {
        slug: data.slug,
        content: data.content ?? "",
        ydocState: data.ydoc_state ?? "",
        isEncrypted: !!data.is_encrypted,
        salt: data.enc_salt,
        check: data.enc_check,
        iterations: data.enc_iterations,
      },
    });
  } catch {
    return json({ error: "temporarily unavailable" }, 503);
  }
});
