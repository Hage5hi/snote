// Endpoint trả về metadata cho 1 note theo slug. Dùng bởi Cloudflare
// Worker để render HTML với og/twitter/canonical tags cho crawler không-JS.
// Bảo vệ bằng shared secret NOTE_META_SECRET (header x-meta-secret).
//
// Fail-closed: nếu NOTE_META_SECRET không được set thì endpoint trả 503,
// trừ khi NOTE_META_ALLOW_INSECURE=1 được set tường minh (local dev).
// Đây là sửa cho finding "auth is optional and silently disabled".
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-meta-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Slug cho phép thêm dấu chấm (vd: my.note) — vẫn an toàn cho path/URL.
const SLUG_RE = /^[a-zA-Z0-9._-]{1,80}$/;

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}

function normalizeSlug(s: string): string {
  // Trim + bỏ '/', decode %XX, gộp khoảng trắng thành '-'.
  let v = s.trim().replace(/^\/+|\/+$/g, "");
  try {
    v = decodeURIComponent(v);
  } catch {
    // ignore
  }
  v = v.replace(/\s+/g, "-");
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    if (url.searchParams.has("token")) {
      return jsonResponse(
        { found: false },
        410,
        { "cache-control": "no-store" },
      );
    }

    // 1. Bảo vệ endpoint bằng shared secret (fail-closed).
    const expected = Deno.env.get("NOTE_META_SECRET") ?? "";
    const allowInsecure =
      Deno.env.get("NOTE_META_ALLOW_INSECURE") === "1";
    if (!expected) {
      if (!allowInsecure) {
        return jsonResponse(
          { error: "server misconfigured: NOTE_META_SECRET unset" },
          503,
        );
      }
      // Local dev fallback — operator has explicitly opted out of auth.
    } else {
      const got = req.headers.get("x-meta-secret") ?? "";
      if (!constantTimeEqual(got, expected)) {
        return jsonResponse({ error: "forbidden" }, 403);
      }
    }

    const rawSlug = url.searchParams.get("slug") ?? "";
    const slug = normalizeSlug(rawSlug);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!SLUG_RE.test(slug)) return jsonResponse({ found: false }, 400);

    const { data: note } = await supabase
      .from("notes")
      .select("slug, is_encrypted, content, char_count, tags, updated_at")
      .eq("slug", slug)
      .maybeSingle();

    if (!note) return jsonResponse({ found: false, slug }, 404);

    let snippet: string | null = null;
    if (!note.is_encrypted && note.content) {
      const plain = String(note.content)
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#>*_`~[\]()!-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      snippet = plain.length > 160 ? plain.slice(0, 157) + "…" : plain;
    }

    // Cache edge 5 phút, SWR 1 giờ. Note mã hoá cache ngắn hơn.
    const cacheControl = note.is_encrypted
      ? "public, max-age=60, s-maxage=60"
      : "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";

    return jsonResponse(
      {
        found: true,
        slug: note.slug,
        isEncrypted: note.is_encrypted,
        snippet,
        charCount: note.char_count,
        tags: note.tags ?? [],
        updatedAt: note.updated_at,
      },
      200,
      { "cache-control": cacheControl },
    );
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
