import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPass(supabase: ReturnType<typeof createClient>, input: string): Promise<boolean> {
  const { data } = await supabase
    .from("admin_config")
    .select("pass_hash")
    .eq("id", 1)
    .maybeSingle();
  if (data?.pass_hash) {
    try { return await bcrypt.compare(input, data.pass_hash); } catch { return false; }
  }
  const expected = Deno.env.get("ADMIN_PASSPHRASE") ?? "";
  if (!expected) return false;
  return constantTimeEqual(input, expected);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const currentPass = String(body?.currentPass ?? "");
    const newPass = String(body?.newPass ?? "");

    if (newPass.length < 12) {
      return new Response(JSON.stringify({ error: "Khoá mới phải ≥ 12 ký tự." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (newPass === currentPass) {
      return new Response(JSON.stringify({ error: "Khoá mới phải khác khoá cũ." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const ok = await verifyPass(supabase, currentPass);
    if (!ok) {
      // Small constant delay to mask timing.
      await new Promise((r) => setTimeout(r, 300));
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hash = await bcrypt.hash(newPass, 10);

    const { error } = await supabase
      .from("admin_config")
      .upsert({ id: 1, pass_hash: hash, updated_at: new Date().toISOString() });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-rotate error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
