import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCapabilityToken,
  decodeCapabilityPayload,
  hashCapabilityAdmissionSubject,
  hashCapabilityToken,
  readCapabilityBearer,
  sha256CapabilityPayload,
  signRealtimeJwt,
} from "../../supabase/functions/_shared/capability.ts";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("capability primitives", () => {
  it("creates 32-byte base64url capabilities", () => {
    const token = createCapabilityToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 32 }, createCapabilityToken)).size).toBe(32);
  });

  it("accepts a capability only from an exact Bearer header", () => {
    const token = createCapabilityToken();
    expect(readCapabilityBearer(new Request("https://example.test/note-session", {
      headers: { authorization: `Bearer ${token}` },
    }))).toBe(token);
    expect(readCapabilityBearer(new Request(`https://example.test/note-session?token=${token}`))).toBeNull();
    expect(readCapabilityBearer(new Request("https://example.test/note-session", {
      headers: { authorization: `bearer ${token}` },
    }))).toBeNull();
    expect(readCapabilityBearer(new Request("https://example.test/note-session", {
      headers: { authorization: `Bearer ${token},Bearer ${token}` },
    }))).toBeNull();
  });

  it("uses a domain-separated HMAC and rejects weak secrets", async () => {
    const token = "A".repeat(43);
    const secret = "B".repeat(43);
    const first = await hashCapabilityToken(token, secret);
    const second = await hashCapabilityToken(token, secret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    await expect(hashCapabilityToken(token, "short")).rejects.toThrow("configuration");
  });

  it("admits only one gateway-verified address and stores a domain-separated hash", async () => {
    const secret = "B".repeat(43);
    const subject = await hashCapabilityAdmissionSubject(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    }), secret);
    expect(subject).toMatch(/^[a-f0-9]{64}$/);
    expect(subject).not.toBe(await hashCapabilityToken("A".repeat(43), secret));
    await expect(hashCapabilityAdmissionSubject(new Request("https://example.test"), secret))
      .resolves.toBeNull();
    await expect(hashCapabilityAdmissionSubject(new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.4" },
    }), secret)).resolves.toBeNull();
  });

  it("decodes bounded canonical payloads without allocating oversized input", () => {
    expect(Array.from(decodeCapabilityPayload("AQID", 3))).toEqual([1, 2, 3]);
    expect(() => decodeCapabilityPayload("AQID", 2)).toThrow("payload too large");
    expect(() => decodeCapabilityPayload("not+base64", 100)).toThrow("invalid payload");
  });

  it("derives the idempotency key from the exact transported bytes", async () => {
    expect(await sha256CapabilityPayload(new Uint8Array([1, 2, 3]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("mints a five-minute scoped Realtime JWT without embedding the raw capability", async () => {
    const token = createCapabilityToken();
    const jwt = await signRealtimeJwt({
      capabilityId: "550e8400-e29b-41d4-a716-446655440000",
      noteId: "123e4567-e89b-12d3-a456-426614174000",
      scope: "edit",
      generation: 7,
      issuer: "https://example.supabase.co/auth/v1",
      secret: "jwt-secret-material-that-is-at-least-thirty-two-bytes",
      nowSeconds: 1_700_000_000,
    });
    const [, encodedPayload] = jwt.split(".");
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    expect(payload).toMatchObject({
      sub: "550e8400-e29b-41d4-a716-446655440000",
      note_id: "123e4567-e89b-12d3-a456-426614174000",
      note_scope: "edit",
      capability_generation: 7,
      role: "authenticated",
      aud: "authenticated",
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
    expect(jwt).not.toContain(token);
  });
});

describe("capability database boundary", () => {
  const migrationPath = "supabase/migrations/20260722000000_capability_backend.sql";

  it("keeps generated database types aligned with admission and cumulative quotas", () => {
    const generatedTypes = source("src/integrations/supabase/types.ts");
    expect(generatedTypes).toContain("storage_limit_bytes: number");
    expect(generatedTypes).toContain("update_limit_count: number");
    expect(generatedTypes).toContain("checkpoint_limit_count: number");
    expect(generatedTypes).toContain("capability_admission_consume:");
    expect(generatedTypes).toContain('p_operation: "create" | "sync"');
  });

  it("publishes security-definer RPCs and grants in one transaction", () => {
    const sql = source("supabase/migrations/20260722000000_capability_backend.sql");
    expect(sql).toMatch(/^--[\s\S]*?\nBEGIN;\s/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
  });

  it("adds immutable note ids, scoped HMAC capabilities, append-only updates, and checkpoints", () => {
    const sql = source(migrationPath);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS note_id uuid");
    expect(sql).toContain("CREATE TRIGGER notes_immutable_identity");
    expect(sql).toContain("CREATE TABLE public.note_capabilities");
    expect(sql).toContain("CREATE TABLE public.note_updates");
    expect(sql).toContain("UNIQUE (note_id, update_id)");
    expect(sql).toContain("CREATE TABLE public.note_checkpoints");
    expect(sql).toContain("reject_append_only_mutation");
    expect(sql).toContain("notes_encryption_metadata_consistent");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS storage_limit_bytes");
  });

  it("keeps secure rows out of legacy public policies and exposes no new direct table grants", () => {
    const sql = source(migrationPath);
    expect(sql).toMatch(/CREATE POLICY "Legacy notes remain readable"[\s\S]+NOT capability_managed/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.note_capabilities[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.note_updates[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.note_checkpoints[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT .+note_(?:capabilities|updates|checkpoints).+ TO (?:anon|authenticated)/i);
    expect(sql).toContain("CREATE TRIGGER note_shares_legacy_targets_only");
    expect(sql).toContain("FUNCTION public.legacy_share_rotate");
  });

  it("authorizes private Realtime topics against active capabilities", () => {
    const sql = source(migrationPath);
    expect(sql).toContain("ON realtime.messages");
    expect(sql).toContain("realtime.topic()");
    expect(sql).toContain("auth.jwt()");
    expect(sql).toContain("revoked_at IS NULL");
    expect(sql).toContain("extension IN ('broadcast', 'presence')");
  });

  it("binds every update to the authorized note, exact payload hash, scope, version, and write state", () => {
    const sql = source(migrationPath);
    const append = sql.slice(
      sql.indexOf("FUNCTION public.capability_updates_append"),
      sql.indexOf("FUNCTION public.capability_note_manage"),
    );
    expect(append).toContain("c.token_hash = p_token_hash");
    expect(append).toContain("c.scope IN ('owner', 'edit')");
    expect(append).toContain("v_note.sync_status <> 'active'");
    expect(append).toContain("v_note.encryption_version <> p_expected_encryption_version");
    expect(append).toContain("extensions.digest(v_payload, 'sha256')");
    expect(append).toContain("-- Validate the complete batch before the first append");
    expect(append).toContain("replace(replace(encode(v_payload, 'base64')");
    expect(append).toContain("ON CONFLICT (note_id, update_id) DO NOTHING");
    expect(append).toContain("read_only_quarantine");
    expect(append).toContain("storage_limit_bytes");
    expect(append).toContain("quota_exceeded");
  });

  it("uses atomic admission windows without retaining raw client addresses", () => {
    const sql = source(migrationPath);
    expect(sql).toContain("CREATE TABLE public.capability_admission_windows");
    expect(sql).toContain("FUNCTION public.capability_admission_consume");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("subject_hash");
    expect(sql).not.toMatch(/capability_admission_windows[\s\S]{0,500}\bip\b/i);
  });

  it("materializes each session from one statement snapshot", () => {
    const sql = source(migrationPath);
    const open = sql.slice(
      sql.indexOf("FUNCTION public.capability_session_open"),
      sql.indexOf("FUNCTION public.capability_updates_append"),
    );
    expect(open).toContain("WITH capability AS MATERIALIZED");
    expect(open).toContain("-- One SQL statement gives metadata, checkpoint, sequence, and updates");
  });

  it("provides service-only atomic RPCs and aggregate payload auditing", () => {
    const sql = source(migrationPath);
    for (const fn of [
      "capability_note_create",
      "capability_session_open",
      "capability_updates_append",
      "capability_note_manage",
      "capability_payload_audit",
    ]) {
      expect(sql).toContain(`FUNCTION public.${fn}`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^;]+ TO service_role`));
    }
    const audit = sql.slice(sql.indexOf("FUNCTION public.capability_payload_audit"));
    expect(audit).not.toMatch(/RETURNS[\s\S]{0,300}\bslug\b/i);
  });

  it("adds edit-scoped checkpoint compaction with checkpoint and encryption CAS", () => {
    const sql = source("supabase/migrations/20260723000000_capability_checkpoint_compaction.sql");
    expect(sql).toContain("FUNCTION public.capability_checkpoint_append");
    expect(sql).toContain("c.scope IN ('owner', 'edit')");
    expect(sql).toContain("p_expected_checkpoint_version");
    expect(sql).toContain("p_expected_encryption_version");
    expect(sql).toContain("v_through_seq > v_current_seq");
    expect(sql).toContain("v_through_seq <= v_latest_through_seq");
    expect(sql).toContain("storage_limit_bytes");
    expect(sql).toContain("checkpoint_limit_count");
    expect(sql).toContain("quota_exceeded");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.capability_checkpoint_append\([^;]+ TO service_role/);
  });
});

describe("Edge capability endpoints", () => {
  it("adds all four APIs and keeps capability tokens out of URL, query, body, and logs", () => {
    for (const name of ["note-session", "note-sync", "note-manage", "share-view"]) {
      const endpoint = source(`supabase/functions/${name}/index.ts`);
      expect(endpoint).toContain("readCapabilityBearer(req)");
      expect(endpoint).not.toContain("searchParams");
      expect(endpoint).not.toMatch(/body\??\.token|body\[.?["']token/i);
      expect(endpoint).not.toMatch(/console\.(?:log|info|warn|error)/);
    }
    const config = source("supabase/config.toml");
    for (const name of ["note-session", "note-sync", "note-manage", "share-view"]) {
      expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s+verify_jwt = false`));
    }
  });

  it("creates and idempotently recovers a note from a client-held owner candidate", () => {
    const endpoint = source("supabase/functions/note-session/index.ts");
    const createBranch = endpoint.slice(
      endpoint.indexOf('if (body?.action === "create")'),
      endpoint.indexOf("const tokenHash = await capabilityTokenHash"),
    );
    expect(createBranch).toContain("if (!bearer)");
    expect(createBranch).toContain("const owner = bearer");
    expect(createBranch).toContain('"capability_admission_consume"');
    expect(createBranch).toContain("created?.session");
    expect(createBranch).toContain("created?.recovered");

    const sql = source("supabase/migrations/20260722000000_capability_backend.sql");
    const createRpc = sql.slice(
      sql.indexOf("FUNCTION public.capability_note_create"),
      sql.indexOf("FUNCTION public.capability_session_open"),
    );
    expect(createRpc).toContain("public.capability_session_open");
    expect(createRpc).toContain("owner_capability.token_hash = p_owner_token_hash");
    expect(createRpc).toContain("'recovered', v_recovered");
  });

  it("admits sync bytes before append and fails closed when admission is unavailable", () => {
    const endpoint = source("supabase/functions/note-sync/index.ts");
    const admission = endpoint.indexOf('"capability_admission_consume"');
    const append = endpoint.indexOf('"capability_updates_append"');
    expect(admission).toBeGreaterThan(0);
    expect(admission).toBeLessThan(append);
    expect(endpoint).toContain("capabilityFailure(\"quota_exceeded\")");
  });

  it("lets capability share readers page every missing update", () => {
    const endpoint = source("supabase/functions/share-view/index.ts");
    expect(endpoint).toContain("const afterSequence = Number(body?.afterSequence ?? 0)");
    expect(endpoint).toContain("p_after_seq: afterSequence");
  });

  it("validates and forwards optional checkpoint CAS through note-sync", () => {
    const endpoint = source("supabase/functions/note-sync/index.ts");
    expect(endpoint).toContain("body?.checkpoint");
    expect(endpoint).toContain('rpc("capability_checkpoint_append"');
    expect(endpoint).toContain("p_expected_checkpoint_version");
    expect(endpoint.match(/totalBytes \+= decoded\.byteLength/g)).toHaveLength(2);
  });

  it("keeps service-role legacy readers away from capability-managed rows", () => {
    const raw = source("supabase/functions/raw/index.ts");
    const shareView = source("supabase/functions/share-view/index.ts");
    const shareCreate = source("supabase/functions/share-create/index.ts");
    expect(raw).toContain('.eq("capability_managed", false)');
    expect(shareView).toContain('.eq("capability_managed", false)');
    expect(shareCreate).toContain('rpc("legacy_share_rotate"');
    expect(shareCreate).not.toContain('.from("notes")');
    expect(shareCreate).not.toContain('.from("note_shares")');
  });

  it("documents the stable NoteSession and idempotent sync contract", () => {
    const contract = source("docs/capability-backend.md");
    for (const field of [
      "noteId",
      "slug",
      "scope",
      "realtimeToken",
      "realtimeExpiresAt",
      "checkpointSequence",
      "missingUpdates",
      "encryption",
    ]) expect(contract).toContain(field);
    expect(contract).toContain("{ updateId, payload }");
    expect(contract).toContain("idempotent");
    expect(contract).toContain("read_only_quarantine");
  });
});
