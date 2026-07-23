// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { expect, it } from "vitest";

type RpcResult = {
  status: string;
  noteId?: string;
  encryptionVersion?: number;
  checkpointVersion?: number;
  recovered?: boolean;
  session?: {
    checkpointPayload?: string | null;
    missingUpdates?: Array<{ payload: string }>;
    noteId: string;
    scope: string;
    slug: string;
  };
  acknowledgements?: Array<{ updateId: string; sequence: number }>;
};

const hash = (value: number[]) =>
  createHash("sha256").update(Buffer.from(value)).digest("hex");
const tokenHash = (character: string) => character.repeat(64);

async function rpc(
  db: PGlite,
  name: string,
  values: unknown[],
  casts: string[] = [],
): Promise<RpcResult> {
  const placeholders = values
    .map((_, index) => `$${index + 1}${casts[index] ?? ""}`)
    .join(",");
  const response = await db.query<{ result: RpcResult }>(
    `select public.${name}(${placeholders}) as result`,
    values,
  );
  return response.rows[0].result;
}

async function setRealtimeClaims(
  db: PGlite,
  capabilityId: string,
  noteId: string,
  scope: "owner" | "edit" | "view",
  generation: number,
  writeDisabled = false,
) {
  const claims = JSON.stringify({
    sub: capabilityId,
    note_id: noteId,
    note_scope: scope,
    capability_generation: generation,
    note_write_disabled: writeDisabled,
  });
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false), "
      + "set_config('request.jwt.claims', $2, false), "
      + "set_config('realtime.topic', $3, false)",
    [capabilityId, claims, `note:${noteId}`],
  );
}

it("executes capability isolation, sync, management, and Realtime RLS in Postgres", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
      CREATE SCHEMA auth;
      CREATE SCHEMA realtime;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
          '{}'::jsonb
        )
      $$;
      CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT current_setting('realtime.topic', true)
      $$;
      CREATE TABLE realtime.messages (extension text NOT NULL);
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA auth, realtime TO authenticated;
      GRANT SELECT, INSERT ON realtime.messages TO authenticated;
      CREATE TABLE public.notes (
        slug text PRIMARY KEY,
        ydoc_state text NOT NULL DEFAULT '',
        content text NOT NULL DEFAULT '',
        char_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        is_encrypted boolean NOT NULL DEFAULT false,
        enc_salt text,
        enc_check text,
        enc_iterations integer NOT NULL DEFAULT 100000,
        tags text[] NOT NULL DEFAULT '{}'
      );
      ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE ON public.notes TO anon, authenticated;
      CREATE TABLE public.note_shares (
        token text PRIMARY KEY,
        slug text NOT NULL UNIQUE REFERENCES public.notes(slug) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE POLICY "Anyone can read notes"
        ON public.notes FOR SELECT TO anon, authenticated USING (true);
      CREATE POLICY "Anyone can create notes"
        ON public.notes FOR INSERT TO anon, authenticated WITH CHECK (true);
      CREATE POLICY "Anyone can update notes"
        ON public.notes FOR UPDATE TO anon, authenticated
        USING (true) WITH CHECK (true);
      INSERT INTO public.notes(slug, content) VALUES ('legacy-row', 'legacy');
    `);
    await db.exec(readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260722000000_capability_backend.sql"),
      "utf8",
    ));
    await db.exec(readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260723000000_capability_checkpoint_compaction.sql"),
      "utf8",
    ));

    const createdA = await rpc(db, "capability_note_create", [
      "secure-a",
      tokenHash("a"),
      tokenHash("b"),
      tokenHash("c"),
    ]);
    expect(createdA.status).toBe("ok");
    expect(createdA.session?.noteId).toBe(createdA.noteId);
    const recoveredA = await rpc(db, "capability_note_create", [
      "secure-a",
      tokenHash("a"),
      tokenHash("7"),
      tokenHash("8"),
    ]);
    expect(recoveredA).toMatchObject({
      status: "ok",
      noteId: createdA.noteId,
      recovered: true,
    });
    await expect(db.exec(`
      INSERT INTO public.note_shares(token, slug)
      VALUES ('legacy-share-cannot-target-secure', 'secure-a')
    `)).rejects.toMatchObject({ code: "23503" });
    const secureLegacyShare = await db.query<{ allowed: boolean }>(
      "SELECT public.legacy_share_rotate($1, $2) AS allowed",
      ["secure-a", "legacy-share-cannot-target-secure"],
    );
    expect(secureLegacyShare.rows[0].allowed).toBe(false);
    expect((await rpc(db, "capability_note_create", [
      "secure-a",
      tokenHash("d"),
      tokenHash("e"),
      tokenHash("f"),
    ])).status).toBe("slug_unavailable");

    const owner = await rpc(db, "capability_session_open", [tokenHash("a"), 0, 200]);
    const view = await rpc(db, "capability_session_open", [tokenHash("c"), 0, 200]);
    expect(owner.session).toMatchObject({ scope: "owner", slug: "secure-a" });
    expect(view.session?.noteId).toBe(owner.session?.noteId);

    const update = { updateId: hash([1, 2, 3]), payload: "AQID" };
    const first = await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [update], 0],
      ["", "::jsonb", ""],
    );
    const retry = await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [update], 0],
      ["", "::jsonb", ""],
    );
    expect(first.status).toBe("ok");
    expect(retry.acknowledgements?.[0].sequence).toBe(
      first.acknowledgements?.[0].sequence,
    );
    expect((await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [{ ...update, payload: "BA" }], 0],
      ["", "::jsonb", ""],
    )).status).toBe("invalid");
    await db.query(
      "UPDATE public.notes SET payload_limit_bytes = 65536 WHERE note_id = $1",
      [createdA.noteId],
    );
    const oversizedBytes = Buffer.alloc(65537, 7);
    const atomicBatch = await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [
        { updateId: hash([5]), payload: "BQ" },
        {
          updateId: createHash("sha256").update(oversizedBytes).digest("hex"),
          payload: oversizedBytes.toString("base64url"),
        },
      ], 0],
      ["", "::jsonb", ""],
    );
    expect(atomicBatch.status).toBe("invalid");
    expect((await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.note_updates WHERE note_id = $1",
      [createdA.noteId],
    )).rows[0].count).toBe(1);
    const longUpdateBytes = Buffer.alloc(60, 13);
    const longUpdate = await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [{
        updateId: createHash("sha256").update(longUpdateBytes).digest("hex"),
        payload: longUpdateBytes.toString("base64url"),
      }], 0],
      ["", "::jsonb", ""],
    );
    expect(longUpdate.status).toBe("ok");
    const pagedLongUpdate = await rpc(
      db,
      "capability_session_open",
      [tokenHash("b"), first.acknowledgements![0].sequence, 20],
    );
    expect(pagedLongUpdate.session?.missingUpdates?.[0].payload).not.toMatch(/[\r\n]/);
    expect((await rpc(
      db,
      "capability_updates_append",
      [tokenHash("c"), [], 0],
      ["", "::jsonb", ""],
    )).status).toBe("unauthorized");

    await db.query(
      "UPDATE public.notes SET storage_limit_bytes = 65536 WHERE note_id = $1",
      [createdA.noteId],
    );
    const quotaBytes = Buffer.alloc(65536, 17);
    expect((await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [{
        updateId: createHash("sha256").update(quotaBytes).digest("hex"),
        payload: quotaBytes.toString("base64url"),
      }], 0],
      ["", "::jsonb", ""],
    )).status).toBe("quota_exceeded");
    expect((await db.query<{ sync_status: string }>(
      "SELECT sync_status::text FROM public.notes WHERE note_id = $1",
      [createdA.noteId],
    )).rows[0].sync_status).toBe("read_only_quarantine");
    await db.query(
      "UPDATE public.notes SET sync_status = 'active', storage_limit_bytes = 67108864 WHERE note_id = $1",
      [createdA.noteId],
    );

    const admission = async (subject: string) => (await db.query<{ allowed: boolean }>(
      "SELECT public.capability_admission_consume('create', $1, 1, 0) AS allowed",
      [subject],
    )).rows[0].allowed;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(await admission(tokenHash("6"))).toBe(true);
    }
    expect(await admission(tokenHash("6"))).toBe(false);
    const importAdmission = async () => (await db.query<{ allowed: boolean }>(
      "SELECT public.capability_admission_consume('create', $1, 1, 4194304) AS allowed",
      [tokenHash("5")],
    )).rows[0].allowed;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      expect(await importAdmission()).toBe(true);
    }
    expect(await importAdmission()).toBe(false);

    const createdB = await rpc(db, "capability_note_create", [
      "secure-b",
      tokenHash("d"),
      tokenHash("e"),
      tokenHash("f"),
    ]);
    expect(createdB.noteId).not.toBe(createdA.noteId);
    expect((await rpc(
      db,
      "capability_updates_append",
      [tokenHash("e"), [{ updateId: hash([4]), payload: "BA" }], 0],
      ["", "::jsonb", ""],
    )).status).toBe("ok");
    expect((await rpc(
      db,
      "capability_note_manage",
      [tokenHash("b"), "rename", { slug: "stolen" }],
      ["", "", "::jsonb"],
    )).status).toBe("unauthorized");
    expect((await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "rename", { slug: "secure-a-renamed" }],
      ["", "", "::jsonb"],
    )).status).toBe("ok");

    const capabilityRows = await db.query<{
      capability_id: string;
      note_id: string;
      scope: "owner" | "edit" | "view";
      generation: number;
    }>(`
      SELECT capability_id, note_id, scope::text AS scope, generation
      FROM public.note_capabilities
      WHERE note_id = $1
      ORDER BY scope
    `, [createdA.noteId]);
    const oldView = capabilityRows.rows.find((row) => row.scope === "view")!;
    const edit = capabilityRows.rows.find((row) => row.scope === "edit")!;
    await db.exec("INSERT INTO realtime.messages(extension) VALUES ('broadcast')");
    await setRealtimeClaims(db, oldView.capability_id, oldView.note_id, "view", 1);
    await db.exec("SET ROLE authenticated");
    expect((await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM realtime.messages",
    )).rows[0].count).toBe(1);
    await expect(db.exec(
      "INSERT INTO realtime.messages(extension) VALUES ('broadcast')",
    )).rejects.toMatchObject({ code: "42501" });
    await db.exec("RESET ROLE");

    await setRealtimeClaims(db, edit.capability_id, edit.note_id, "edit", 1);
    await db.exec("SET ROLE authenticated");
    await expect(db.exec(
      "INSERT INTO realtime.messages(extension) VALUES ('broadcast')",
    )).resolves.toBeDefined();
    await db.exec("RESET ROLE");

    expect((await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "rotate", { scope: "view", tokenHash: tokenHash("9") }],
      ["", "", "::jsonb"],
    )).status).toBe("ok");
    expect((await rpc(
      db,
      "capability_session_open",
      [tokenHash("c"), 0, 20],
    )).status).toBe("unauthorized");
    await setRealtimeClaims(db, oldView.capability_id, oldView.note_id, "view", 1);
    await db.exec("SET ROLE authenticated");
    expect((await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM realtime.messages",
    )).rows[0].count).toBe(0);
    await db.exec("RESET ROLE");

    const sequence = longUpdate.acknowledgements![0].sequence;
    const longCheckpointBytes = Buffer.alloc(60, 9);
    const encrypted = await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "set-encryption", {
        isEncrypted: true,
        expectedEncryptionVersion: 0,
        salt: "s".repeat(16),
        check: "c".repeat(16),
        iterations: 100000,
        checkpoint: {
          checkpointId: createHash("sha256").update(longCheckpointBytes).digest("hex"),
          payload: longCheckpointBytes.toString("base64url"),
          throughSequence: sequence,
        },
      }],
      ["", "", "::jsonb"],
    );
    expect(encrypted).toMatchObject({ status: "ok", encryptionVersion: 1 });
    expect(await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "set-encryption", {
        isEncrypted: true,
        expectedEncryptionVersion: 0,
        salt: "s".repeat(16),
        check: "c".repeat(16),
        iterations: 100000,
        checkpoint: {
          checkpointId: createHash("sha256").update(longCheckpointBytes).digest("hex"),
          payload: longCheckpointBytes.toString("base64url"),
          throughSequence: sequence,
        },
      }],
      ["", "", "::jsonb"],
    )).toMatchObject({
      status: "ok",
      encryptionVersion: 1,
      recovered: true,
    });
    const encryptedSession = await rpc(
      db,
      "capability_session_open",
      [tokenHash("a"), sequence, 20],
    );
    expect(encryptedSession.session?.checkpointPayload).not.toMatch(/[\r\n]/);
    expect((await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [], 0],
      ["", "::jsonb", ""],
    )).status).toBe("version_conflict");
    expect(await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "set-encryption", {
        isEncrypted: false,
        expectedEncryptionVersion: 1,
        iterations: 100000,
        checkpoint: {
          checkpointId: hash([10]),
          payload: "Cg",
          throughSequence: sequence,
        },
      }],
      ["", "", "::jsonb"],
    )).toMatchObject({ status: "ok", encryptionVersion: 2 });
    expect(await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "set-encryption", {
        isEncrypted: true,
        expectedEncryptionVersion: 2,
        salt: "t".repeat(16),
        check: "d".repeat(16),
        iterations: 100000,
        checkpoint: {
          checkpointId: hash([11]),
          payload: "Cw",
          throughSequence: sequence,
        },
      }],
      ["", "", "::jsonb"],
    )).toMatchObject({ status: "ok", encryptionVersion: 3 });
    expect(await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "set-encryption", {
        isEncrypted: false,
        expectedEncryptionVersion: 3,
        iterations: 100000,
        checkpoint: {
          checkpointId: hash([10]),
          payload: "Cg",
          throughSequence: sequence,
        },
      }],
      ["", "", "::jsonb"],
    )).toMatchObject({ status: "ok", encryptionVersion: 4 });
    const postTransitionUpdate = await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [{ updateId: hash([12]), payload: "DA" }], 4],
      ["", "::jsonb", ""],
    );
    expect(postTransitionUpdate.status).toBe("ok");
    const compactionSequence = postTransitionUpdate.acknowledgements![0].sequence;
    const compactedBytes = Buffer.from([13, 14]);
    expect(await rpc(
      db,
      "capability_checkpoint_append",
      [tokenHash("b"), {
        checkpointId: createHash("sha256").update(compactedBytes).digest("hex"),
        payload: compactedBytes.toString("base64url"),
        throughSequence: compactionSequence,
      }, 4, 4],
      ["", "::jsonb", "", ""],
    )).toMatchObject({ status: "ok", checkpointVersion: 5 });
    expect(await rpc(
      db,
      "capability_checkpoint_append",
      [tokenHash("b"), {
        checkpointId: hash([15]),
        payload: "Dw",
        throughSequence: compactionSequence,
      }, 4, 4],
      ["", "::jsonb", "", ""],
    )).toMatchObject({ status: "version_conflict" });
    const quotaUpdate = await rpc(
      db,
      "capability_updates_append",
      [tokenHash("b"), [{ updateId: hash([16]), payload: "EA" }], 4],
      ["", "::jsonb", ""],
    );
    expect(quotaUpdate.status).toBe("ok");
    await db.query(
      "UPDATE public.notes SET checkpoint_limit_count = 5 WHERE note_id = $1",
      [createdA.noteId],
    );
    expect(await rpc(
      db,
      "capability_checkpoint_append",
      [tokenHash("b"), {
        checkpointId: hash([17]),
        payload: "EQ",
        throughSequence: quotaUpdate.acknowledgements![0].sequence,
      }, 5, 4],
      ["", "::jsonb", "", ""],
    )).toMatchObject({ status: "quota_exceeded" });
    expect((await db.query<{ sync_status: string }>(
      "SELECT sync_status::text FROM public.notes WHERE note_id = $1",
      [createdA.noteId],
    )).rows[0].sync_status).toBe("read_only_quarantine");
    await db.query(
      `UPDATE public.notes
       SET sync_status = 'active', checkpoint_limit_count = 256
       WHERE note_id = $1`,
      [createdA.noteId],
    );
    await db.query(
      "UPDATE public.notes SET sync_status = 'read_only_quarantine' WHERE note_id = $1",
      [createdA.noteId],
    );
    expect(await rpc(
      db,
      "capability_note_manage",
      [tokenHash("a"), "set-encryption", {
        isEncrypted: true,
        expectedEncryptionVersion: 4,
        salt: "u".repeat(16),
        check: "e".repeat(16),
        iterations: 100000,
        checkpoint: {
          checkpointId: hash([12]),
          payload: "DA",
          throughSequence: sequence,
        },
      }],
      ["", "", "::jsonb"],
    )).toMatchObject({ status: "read_only" });
    expect((await db.query<{ encryption_version: number }>(
      "SELECT encryption_version FROM public.notes WHERE note_id = $1",
      [createdA.noteId],
    )).rows[0].encryption_version).toBe(4);
    await db.query(
      "UPDATE public.notes SET sync_status = 'active' WHERE note_id = $1",
      [createdA.noteId],
    );

    await db.exec("SET ROLE anon");
    expect((await db.query<{ slug: string }>(
      "SELECT slug FROM public.notes ORDER BY slug",
    )).rows).toEqual([{ slug: "legacy-row" }]);
    await db.exec("RESET ROLE");

    await expect(db.exec(
      "UPDATE public.note_updates SET payload = '\\x01'::bytea",
    )).rejects.toMatchObject({ code: "55000" });
    expect((await rpc(
      db,
      "capability_note_manage",
      [tokenHash("d"), "delete", {}],
      ["", "", "::jsonb"],
    )).status).toBe("ok");
    expect((await rpc(
      db,
      "capability_session_open",
      [tokenHash("d"), 0, 20],
    )).status).toBe("unauthorized");
    expect((await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.note_updates WHERE note_id = $1",
      [createdB.noteId],
    )).rows[0].count).toBe(0);
    const audit = await db.query<Record<string, unknown>>(
      "SELECT * FROM public.capability_payload_audit(1048576)",
    );
    expect(Object.keys(audit.rows[0])).not.toEqual(
      expect.arrayContaining(["slug", "content", "token", "ip"]),
    );

    await db.exec(readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260724000000_atomic_capability_cutover.sql"),
      "utf8",
    ));

    await db.exec("SET ROLE anon");
    await expect(db.query("SELECT slug FROM public.notes"))
      .rejects.toMatchObject({ code: "42501" });
    await db.exec("RESET ROLE");

    await db.exec("SET ROLE service_role");
    await expect(db.query(
      "SELECT public.legacy_share_rotate($1, $2)",
      ["legacy-row", "x".repeat(32)],
    )).rejects.toMatchObject({ code: "42501" });

    const importBytes = Buffer.alloc(60, 23);
    const imported = await rpc(db, "capability_note_import_legacy", [
      "legacy-copy",
      tokenHash("1"),
      tokenHash("2"),
      tokenHash("3"),
      createHash("sha256").update(importBytes).digest("hex"),
      importBytes.toString("base64url"),
      true,
      "s".repeat(16),
      "c".repeat(16),
      100000,
    ]);
    expect(imported).toMatchObject({
      status: "ok",
      recovered: false,
      session: {
        slug: "legacy-copy",
        scope: "owner",
        checkpointPayload: importBytes.toString("base64url"),
      },
    });

    const recoveredImport = await rpc(db, "capability_note_import_legacy", [
      "legacy-copy",
      tokenHash("1"),
      tokenHash("4"),
      tokenHash("5"),
      createHash("sha256").update(importBytes).digest("hex"),
      importBytes.toString("base64url"),
      true,
      "s".repeat(16),
      "c".repeat(16),
      100000,
    ]);
    expect(recoveredImport).toMatchObject({
      status: "ok",
      noteId: imported.noteId,
      recovered: true,
    });
    expect((await rpc(db, "capability_note_import_legacy", [
      "legacy-copy",
      tokenHash("9"),
      tokenHash("7"),
      tokenHash("8"),
      createHash("sha256").update(importBytes).digest("hex"),
      importBytes.toString("base64url"),
      true,
      "s".repeat(16),
      "c".repeat(16),
      100000,
    ])).status).toBe("slug_unavailable");
    await db.exec("RESET ROLE");

    const importedRows = await db.query<{ notes: number; capabilities: number; checkpoints: number }>(`
      SELECT
        (SELECT count(*)::integer FROM public.notes WHERE slug = 'legacy-copy') AS notes,
        (SELECT count(*)::integer FROM public.note_capabilities
          WHERE note_id = (SELECT note_id FROM public.notes WHERE slug = 'legacy-copy')) AS capabilities,
        (SELECT count(*)::integer FROM public.note_checkpoints
          WHERE note_id = (SELECT note_id FROM public.notes WHERE slug = 'legacy-copy')) AS checkpoints
    `);
    expect(importedRows.rows[0]).toEqual({ notes: 1, capabilities: 3, checkpoints: 1 });

    const importedOwner = await db.query<{ capability_id: string }>(`
      SELECT capability_id
      FROM public.note_capabilities
      WHERE token_hash = $1
    `, [tokenHash("1")]);
    await setRealtimeClaims(
      db,
      importedOwner.rows[0].capability_id,
      imported.session!.noteId,
      "owner",
      1,
      true,
    );
    await db.exec("SET ROLE authenticated");
    await expect(db.exec(
      "INSERT INTO realtime.messages(extension) VALUES ('broadcast')",
    )).rejects.toMatchObject({ code: "42501" });
    await db.exec("RESET ROLE");

    const invalidImport = await rpc(db, "capability_note_import_legacy", [
      "orphan-must-not-exist",
      tokenHash("4"),
      tokenHash("5"),
      tokenHash("6"),
      hash([99]),
      importBytes.toString("base64url"),
      false,
      null,
      null,
      null,
    ], ["", "", "", "", "", "", "", "", "", "::integer"]);
    expect(invalidImport.status).toBe("invalid");
    expect((await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.notes WHERE slug = 'orphan-must-not-exist'",
    )).rows[0].count).toBe(0);
  } finally {
    await db.close();
  }
}, 30_000);
