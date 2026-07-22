import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  adminAuthResponse,
  authorizeAdminSession,
  hashAdminPass,
  serviceUnavailableResponse,
} from "../_shared/admin-auth.ts";
import { isValidAdminPassphrase } from "../_shared/admin-passphrase.ts";

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
  const newPass = typeof body?.newPass === "string" ? body.newPass : "";
  if (!isValidAdminPassphrase(newPass)) {
    return json({ error: "new key must be between 12 and 72 UTF-8 bytes" }, 400);
  }

  let passHash: string;
  try {
    passHash = await hashAdminPass(newPass);
  } catch {
    return serviceUnavailableResponse(corsHeaders);
  }
  try {
    const { error } = await supabase.rpc("admin_pass_rotate", {
      p_pass_hash: passHash,
      p_token_hash: authorization.tokenHash,
      p_subject_hash: authorization.subjectHash,
    });
    if (error) return serviceUnavailableResponse(corsHeaders);
  } catch {
    return serviceUnavailableResponse(corsHeaders);
  }

  return json({ ok: true }, 200);
});
