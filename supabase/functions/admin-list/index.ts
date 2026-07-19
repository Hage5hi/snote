import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  adminAuthResponse,
  authorizeAdminSession,
  serviceUnavailableResponse,
} from "../_shared/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-admin-session, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return serviceUnavailableResponse(corsHeaders);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const authorization = await authorizeAdminSession(req, supabase);
  if (authorization.status !== "authorized") {
    return adminAuthResponse(authorization, corsHeaders);
  }

  const body = await req.json().catch(() => ({}));
  const search = typeof body?.search === "string" ? body.search.trim() : "";
  const tag = typeof body?.tag === "string" ? body.tag.trim().toLowerCase() : "";
  const limit = Math.min(
    Math.max(Number.parseInt(body?.limit ?? "100", 10) || 100, 1),
    500,
  );
  const offset = Math.max(Number.parseInt(body?.offset ?? "0", 10) || 0, 0);

  let query = supabase
    .from("notes")
    .select("slug, char_count, is_encrypted, updated_at, created_at, content, tags", {
      count: "exact",
    })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    const safe = search.replace(/[%_,()"*\\]/g, "").slice(0, 100);
    if (safe) query = query.or(`slug.ilike.%${safe}%,content.ilike.%${safe}%`);
  }
  if (tag) {
    const safeTag = tag.replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    if (safeTag) query = query.contains("tags", [safeTag]);
  }

  const { data, error, count } = await query;
  if (error) return serviceUnavailableResponse(corsHeaders);

  const items = (data ?? []).map((row) => ({
    slug: row.slug,
    char_count: row.char_count,
    is_encrypted: row.is_encrypted,
    updated_at: row.updated_at,
    created_at: row.created_at,
    tags: row.tags ?? [],
    preview: row.is_encrypted ? "encrypted" : (row.content ?? "").slice(0, 200),
  }));

  const tagCount = new Map<string, number>();
  for (const item of items) {
    for (const itemTag of item.tags as string[]) {
      tagCount.set(itemTag, (tagCount.get(itemTag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCount.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([name, itemCount]) => ({ name, count: itemCount }));

  return json({ items, total: count ?? items.length, topTags }, 200);
});

