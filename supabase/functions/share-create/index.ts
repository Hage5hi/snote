import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";

type ShareDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      legacy_share_rotate: {
        Args: { p_slug: string; p_token: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    if (!SLUG_RE.test(slug)) return json({ error: "invalid slug" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "temporarily unavailable" }, 503);
    }
    const supabase = createClient<ShareDatabase>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      const token = generateToken();
      const { error } = await supabase.rpc("legacy_share_rotate", {
        p_slug: slug,
        p_token: token,
      });
      if (!error) {
        // A secure slug receives the same shape with a non-persisted decoy.
        // This prevents an existence oracle while the PR5 compatibility shell
        // is still present; capability clients never call this endpoint.
        return json({ token }, 200);
      }
    }
    return json({ error: "temporarily unavailable" }, 503);
  } catch {
    return json({ error: "temporarily unavailable" }, 503);
  }
});
