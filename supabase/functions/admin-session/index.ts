import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  adminAuthResponse,
  authorizeAdminSession,
  getAdminSubjectHash,
  serviceUnavailableResponse,
  sha256Hex,
  verifyAdminPass,
} from "../_shared/admin-auth.ts";
import {
  beginAdminAuthAttempt,
  completeAdminAuthAttempt,
  lockoutResponse,
} from "../_shared/admin-rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-admin-session, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
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

function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function createAdmissionLeaseId(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}

function sessionTtlMinutes(): number {
  const configured = Number.parseInt(
    Deno.env.get("ADMIN_SESSION_TTL_MINUTES") ?? "15",
    10,
  );
  return Math.min(30, Math.max(5, Number.isFinite(configured) ? configured : 15));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "DELETE") {
    return json({ error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return serviceUnavailableResponse(corsHeaders);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "DELETE") {
    const authorization = await authorizeAdminSession(req, supabase);
    if (authorization.status !== "authorized") {
      return adminAuthResponse(authorization, corsHeaders);
    }
    try {
      const { error } = await supabase.rpc("admin_session_revoke", {
        p_token_hash: authorization.tokenHash,
        p_subject_hash: authorization.subjectHash,
      });
      if (error) return serviceUnavailableResponse(corsHeaders);
    } catch {
      return serviceUnavailableResponse(corsHeaders);
    }
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, "Cache-Control": "no-store" },
    });
  }

  const subject = await getAdminSubjectHash(req);
  if (!subject.ok) return serviceUnavailableResponse(corsHeaders);

  const body = await req.json().catch(() => ({}));
  const passphrase = String(body?.passphrase ?? "").slice(0, 1024);
  let leaseId: string;
  try {
    leaseId = createAdmissionLeaseId();
  } catch {
    return serviceUnavailableResponse(corsHeaders);
  }

  const gate = await beginAdminAuthAttempt(
    supabase,
    subject.subjectHash,
    leaseId,
  );
  if (!gate.available) return serviceUnavailableResponse(corsHeaders);
  if (!gate.allowed) return lockoutResponse(gate.retryAfterSeconds, corsHeaders);

  const verified = await verifyAdminPass(supabase, passphrase);
  if (!verified.available) return serviceUnavailableResponse(corsHeaders);

  const recorded = await completeAdminAuthAttempt(
    supabase,
    subject.subjectHash,
    leaseId,
    verified.valid,
  );
  if (!recorded.available) return serviceUnavailableResponse(corsHeaders);
  if (!verified.valid) {
    return recorded.allowed
      ? json({ error: "unauthorized" }, 401)
      : lockoutResponse(recorded.retryAfterSeconds, corsHeaders);
  }
  if (!recorded.allowed) return serviceUnavailableResponse(corsHeaders);

  try {
    const sessionToken = createSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAt = new Date(
      Date.now() + sessionTtlMinutes() * 60 * 1000,
    ).toISOString();
    const { error } = await supabase.from("admin_sessions").insert({
      token_hash: tokenHash,
      subject_hash: subject.subjectHash,
      expires_at: expiresAt,
    });
    if (error) return serviceUnavailableResponse(corsHeaders);

    return json({ sessionToken, expiresAt }, 200);
  } catch {
    return serviceUnavailableResponse(corsHeaders);
  }
});

