import {
  decodeCapabilityPayload,
  readCapabilityBearer,
  sha256CapabilityPayload,
  UPDATE_ID_RE,
} from "../_shared/capability.ts";
import {
  capabilityCorsHeaders,
  capabilityEnvironment,
  capabilityFailure,
  capabilityJson,
  capabilityTokenHash,
  capabilityWritesDisabled,
  materializeNoteSession,
  rpcStatus,
} from "../_shared/capability-edge.ts";

const MAX_BATCH_BYTES = 4 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: capabilityCorsHeaders });
  if (req.method !== "POST") return capabilityJson({ error: "method not allowed" }, 405);
  if (capabilityWritesDisabled()) return capabilityFailure("read_only");

  const bearer = readCapabilityBearer(req);
  if (!bearer) return capabilityJson({ error: "unauthorized" }, 401);
  const environment = capabilityEnvironment();
  if (!environment.ok) return capabilityFailure("unavailable");

  try {
    const tokenHash = await capabilityTokenHash(bearer, environment.hmacSecret);
    if (!tokenHash) return capabilityFailure("unavailable");
    const body = await req.json().catch(() => ({}));
    const updates = body?.updates;
    const expectedEncryptionVersion = Number(body?.expectedEncryptionVersion);
    const afterSequence = Number(body?.afterSequence ?? 0);
    const checkpoint = body?.checkpoint;
    if (
      !Array.isArray(updates)
      || updates.length > 100
      || !Number.isSafeInteger(expectedEncryptionVersion)
      || expectedEncryptionVersion < 0
      || !Number.isSafeInteger(afterSequence)
      || afterSequence < 0
    ) return capabilityFailure("invalid");

    let totalBytes = 0;
    const normalized: Array<{ updateId: string; payload: string }> = [];
    for (const update of updates) {
      const updateId = typeof update?.updateId === "string" ? update.updateId : "";
      const payload = typeof update?.payload === "string" ? update.payload : "";
      if (!UPDATE_ID_RE.test(updateId)) return capabilityFailure("invalid");
      const decoded = decodeCapabilityPayload(payload, MAX_BATCH_BYTES);
      totalBytes += decoded.byteLength;
      if (totalBytes > MAX_BATCH_BYTES) return capabilityFailure("payload_too_large");
      if (await sha256CapabilityPayload(decoded) !== updateId) {
        return capabilityFailure("invalid");
      }
      normalized.push({ updateId, payload });
    }

    let normalizedCheckpoint: {
      checkpointId: string;
      payload: string;
      throughSequence: number;
      expectedCheckpointVersion: number;
    } | null = null;
    if (checkpoint !== undefined) {
      const checkpointId = typeof checkpoint?.checkpointId === "string"
        ? checkpoint.checkpointId
        : "";
      const payload = typeof checkpoint?.payload === "string" ? checkpoint.payload : "";
      const throughSequence = Number(checkpoint?.throughSequence);
      const expectedCheckpointVersion = Number(checkpoint?.expectedCheckpointVersion);
      if (
        !UPDATE_ID_RE.test(checkpointId)
        || !Number.isSafeInteger(throughSequence)
        || throughSequence < 0
        || !Number.isSafeInteger(expectedCheckpointVersion)
        || expectedCheckpointVersion < 0
      ) return capabilityFailure("invalid");
      const decoded = decodeCapabilityPayload(payload, MAX_BATCH_BYTES);
      totalBytes += decoded.byteLength;
      if (totalBytes > MAX_BATCH_BYTES) return capabilityFailure("payload_too_large");
      if (await sha256CapabilityPayload(decoded) !== checkpointId) {
        return capabilityFailure("invalid");
      }
      normalizedCheckpoint = {
        checkpointId,
        payload,
        throughSequence,
        expectedCheckpointVersion,
      };
    }

    const { data: appended, error: appendError } = await environment.client.rpc(
      "capability_updates_append",
      {
        p_token_hash: tokenHash,
        p_updates: normalized,
        p_expected_encryption_version: expectedEncryptionVersion,
      },
    );
    if (appendError || rpcStatus(appended) !== "ok") {
      return capabilityFailure(appendError ? "unavailable" : rpcStatus(appended));
    }

    let compacted: unknown = null;
    if (normalizedCheckpoint) {
      const { expectedCheckpointVersion, ...checkpointPayload } = normalizedCheckpoint;
      const { data, error } = await environment.client.rpc("capability_checkpoint_append", {
        p_token_hash: tokenHash,
        p_checkpoint: checkpointPayload,
        p_expected_checkpoint_version: expectedCheckpointVersion,
        p_expected_encryption_version: expectedEncryptionVersion,
      });
      if (error || rpcStatus(data) !== "ok") {
        return capabilityFailure(error ? "unavailable" : rpcStatus(data));
      }
      compacted = data;
    }

    const { data: opened, error: openError } = await environment.client.rpc(
      "capability_session_open",
      { p_token_hash: tokenHash, p_after_seq: afterSequence, p_limit: 500 },
    );
    if (openError || rpcStatus(opened) !== "ok") {
      return capabilityFailure(openError ? "unavailable" : rpcStatus(opened));
    }
    const session = await materializeNoteSession(
      opened?.session,
      environment.supabaseUrl,
      environment.jwtSecret,
    );
    if (!session) return capabilityFailure("unavailable");
    return capabilityJson({
      acknowledgements: appended?.acknowledgements ?? [],
      ...(compacted ? { checkpoint: compacted } : {}),
      session,
    }, 200);
  } catch (error) {
    if (error instanceof Error && /payload|invalid/.test(error.message)) {
      return capabilityFailure("invalid");
    }
    return capabilityFailure("unavailable");
  }
});
