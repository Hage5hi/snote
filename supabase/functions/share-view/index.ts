import { readCapabilityBearer } from "../_shared/capability.ts";
import {
  capabilityCorsHeaders,
  capabilityEnvironment,
  capabilityFailure,
  capabilityJson,
  capabilityTokenHash,
  materializeNoteSession,
  rpcStatus,
} from "../_shared/capability-edge.ts";

const LEGACY_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: capabilityCorsHeaders });
  if (req.method !== "POST") return capabilityJson({ error: "method not allowed" }, 405);

  const environment = capabilityEnvironment();
  if (!environment.ok) return capabilityFailure("unavailable");

  try {
    const bearer = readCapabilityBearer(req);
    if (bearer) {
      const body = await req.json().catch(() => ({}));
      const afterSequence = Number(body?.afterSequence ?? 0);
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        return capabilityFailure("invalid");
      }
      const tokenHash = await capabilityTokenHash(bearer, environment.hmacSecret);
      if (!tokenHash) return capabilityFailure("unavailable");
      const { data, error } = await environment.client.rpc("capability_session_open", {
        p_token_hash: tokenHash,
        p_after_seq: afterSequence,
        p_limit: 500,
      });
      if (error || rpcStatus(data) !== "ok") {
        return capabilityFailure(error ? "unavailable" : rpcStatus(data));
      }
      const session = await materializeNoteSession(
        data?.session,
        environment.supabaseUrl,
        environment.jwtSecret,
      );
      return session
        ? capabilityJson({ session }, 200)
        : capabilityFailure("unavailable");
    }

    // Temporary dual-mode compatibility only. New capabilities are never
    // accepted here; the legacy opaque share is moved out of the JSON body so
    // gateways and application error serializers cannot capture it there.
    const legacyShare = req.headers.get("x-legacy-share")?.trim() ?? "";
    if (!LEGACY_TOKEN_RE.test(legacyShare)) {
      return capabilityJson({ error: "unauthorized" }, 401);
    }
    const { data: share, error: shareError } = await environment.client
      .from("note_shares")
      .select("slug")
      .eq("token", legacyShare)
      .maybeSingle();
    if (shareError || !share) return capabilityJson({ error: "not found" }, 404);

    const { data: note, error: noteError } = await environment.client
      .from("notes")
      .select("content, ydoc_state, is_encrypted, enc_salt, enc_check, enc_iterations, updated_at")
      .eq("slug", share.slug)
      .eq("capability_managed", false)
      .maybeSingle();
    if (noteError || !note) return capabilityJson({ error: "not found" }, 404);

    return capabilityJson({
      content: note.content,
      ydoc_state: note.ydoc_state,
      is_encrypted: note.is_encrypted,
      enc_salt: note.enc_salt,
      enc_check: note.enc_check,
      enc_iterations: note.enc_iterations,
      updated_at: note.updated_at,
    }, 200);
  } catch {
    return capabilityFailure("unavailable");
  }
});
