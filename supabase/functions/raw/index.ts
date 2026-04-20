import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Path: /functions/v1/raw/<slug> OR /raw/<slug> OR /<slug>
    const parts = url.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] ?? "";

    if (!SLUG_RE.test(slug)) {
      return new Response("Invalid slug\n", {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("notes")
      .select("content, ydoc_state, is_encrypted, char_count")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("raw select error", error);
      return new Response(`# error: ${error.message}\n`, {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (!data) {
      return new Response(`# Note /${slug} không tồn tại.\n`, {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (data.is_encrypted) {
      const appUrl = Deno.env.get("APP_URL");
      const decryptHint = appUrl
        ? `# Encrypted note. Open ${appUrl}/${slug}#<your-key> to decrypt.\n`
        : `# Encrypted note. Open it in the app with #<your-key> in the URL hash to decrypt.\n`;
      const body =
        decryptHint +
        `# ydoc_state (base64 ciphertext) below:\n\n` +
        (data.ydoc_state ?? "");
      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "X-Encrypted": "1",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(data.content ?? "", {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("raw exception", e);
    return new Response(`# server error\n`, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
