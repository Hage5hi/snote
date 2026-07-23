import {
  createCapabilityToken,
  hashCapabilityAdmissionSubject,
  hashCapabilityToken,
  readCapabilityBearer,
} from "../_shared/capability.ts";
import {
  capabilityCorsHeaders,
  capabilityEnvironment,
  capabilityFailure,
  capabilityJson,
  capabilityTokenHash,
  materializeNoteSession,
  rpcStatus,
} from "../_shared/capability-edge.ts";

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: capabilityCorsHeaders });
  if (req.method !== "POST") return capabilityJson({ error: "method not allowed" }, 405);

  const environment = capabilityEnvironment();
  if (!environment.ok) return capabilityFailure("unavailable");

  try {
    const body = await req.json().catch(() => ({}));
    const bearer = readCapabilityBearer(req);

    if (body?.action === "create") {
      if (!bearer) return capabilityJson({ error: "unauthorized" }, 401);
      const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
      if (!SLUG_RE.test(slug)) return capabilityFailure("invalid");

      const owner = bearer;
      const edit = createCapabilityToken();
      const view = createCapabilityToken();
      const subjectHash = await hashCapabilityAdmissionSubject(req, environment.hmacSecret);
      if (!subjectHash) return capabilityFailure("unavailable");
      const [ownerHash, editHash, viewHash] = await Promise.all([
        hashCapabilityToken(owner, environment.hmacSecret),
        hashCapabilityToken(edit, environment.hmacSecret),
        hashCapabilityToken(view, environment.hmacSecret),
      ]);
      const { data: admitted, error: admissionError } = await environment.client.rpc(
        "capability_admission_consume",
        {
          p_operation: "create",
          p_subject_hash: subjectHash,
          p_request_cost: 1,
          p_byte_cost: 0,
        },
      );
      if (admissionError) return capabilityFailure("unavailable");
      if (admitted !== true) return capabilityFailure("quota_exceeded");
      const { data: created, error: createError } = await environment.client.rpc(
        "capability_note_create",
        {
          p_slug: slug,
          p_owner_token_hash: ownerHash,
          p_edit_token_hash: editHash,
          p_view_token_hash: viewHash,
        },
      );
      if (createError || rpcStatus(created) !== "ok") {
        return capabilityFailure(createError ? "unavailable" : rpcStatus(created));
      }

      const session = await materializeNoteSession(
        created?.session,
        environment.supabaseUrl,
        environment.jwtSecret,
      );
      if (!session) return capabilityFailure("unavailable");
      const capabilities = created?.recovered === true
        ? { owner }
        : { owner, edit, view };
      return capabilityJson({ session, capabilities }, created?.recovered === true ? 200 : 201);
    }

    if (!bearer) return capabilityJson({ error: "unauthorized" }, 401);
    const tokenHash = await capabilityTokenHash(bearer, environment.hmacSecret);
    if (!tokenHash) return capabilityFailure("unavailable");
    const afterSequence = Number(body?.afterSequence ?? 0);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return capabilityFailure("invalid");
    }

    const { data, error } = await environment.client.rpc("capability_session_open", {
      p_token_hash: tokenHash,
      p_after_seq: afterSequence,
      p_limit: 200,
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
  } catch {
    return capabilityFailure("unavailable");
  }
});
