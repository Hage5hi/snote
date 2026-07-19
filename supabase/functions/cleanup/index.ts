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

// Deletes only server-verifiable plaintext empties. Encrypted state is opaque;
// ciphertext length is never evidence that a note is empty.
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
  const olderThanHours = Math.min(
    24 * 365,
    Math.max(Number.parseInt(body?.olderThanHours ?? "1", 10) || 1, 1),
  );
  const cutoff = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000,
  ).toISOString();

  const { error, count } = await supabase
    .from("notes")
    .delete({ count: "exact" })
    .eq("is_encrypted", false)
    .eq("char_count", 0)
    .lt("created_at", cutoff);
  if (error) return serviceUnavailableResponse(corsHeaders);

  return json(
    {
      deleted: count ?? 0,
      plaintext: count ?? 0,
      encrypted: 0,
      cutoff,
    },
    200,
  );
});

