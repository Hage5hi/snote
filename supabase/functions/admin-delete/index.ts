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
// Admin maintenance must accept every locator already persisted by the
// legacy note-meta contract, including dots and 65-80 character slugs.
const SLUG_RE = /^[A-Za-z0-9._-]{1,80}$/;

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
  if (body?.all === true) {
    try {
      const { data, error } = await supabase.rpc("admin_notes_delete", {
        p_token_hash: authorization.tokenHash,
        p_subject_hash: authorization.subjectHash,
        p_all: true,
        p_slugs: [],
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        return serviceUnavailableResponse(corsHeaders);
      }
      if (data.authorized !== true) {
        return adminAuthResponse({ status: "unauthorized" }, corsHeaders);
      }
      const deleted = Number(data.deleted);
      return Number.isSafeInteger(deleted) && deleted >= 0
        ? json({ deleted }, 200)
        : serviceUnavailableResponse(corsHeaders);
    } catch {
      return serviceUnavailableResponse(corsHeaders);
    }
  }

  if (!Array.isArray(body?.slugs) || body.slugs.length === 0) {
    return json({ error: "slugs[] required" }, 400);
  }
  const slugs = [
    ...new Set(
      body.slugs.filter(
        (value: unknown): value is string =>
          typeof value === "string" && SLUG_RE.test(value),
      ),
    ),
  ].slice(0, 500);
  if (slugs.length === 0) return json({ error: "valid slugs[] required" }, 400);

  try {
    const { data, error } = await supabase.rpc("admin_notes_delete", {
      p_token_hash: authorization.tokenHash,
      p_subject_hash: authorization.subjectHash,
      p_all: false,
      p_slugs: slugs,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return serviceUnavailableResponse(corsHeaders);
    }
    if (data.authorized !== true) {
      return adminAuthResponse({ status: "unauthorized" }, corsHeaders);
    }
    const deleted = Number(data.deleted);
    return Number.isSafeInteger(deleted) && deleted >= 0
      ? json({ deleted }, 200)
      : serviceUnavailableResponse(corsHeaders);
  } catch {
    return serviceUnavailableResponse(corsHeaders);
  }
});

