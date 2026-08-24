# Storage Delete Replay Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the historical unused-bucket cleanup migration replay safely against Supabase Storage's current direct-delete protection without weakening that protection.

**Architecture:** Reproduce the failure in a focused PGlite integration test that installs the same statement-level protection trigger used by Storage `v1.69.11`. Wrap only the two intended deletes in a PostgreSQL anonymous block with Supabase's transaction-local `storage.allow_delete_query` setting, then prove the guard is disabled again after the migration.

**Tech Stack:** PostgreSQL SQL, Supabase migrations, PGlite `0.5.4`, Vitest `3.2.6`, Bun `1.3.14`.

---

## File map

- Create `scripts/__tests__/storage-delete-migration.integration.test.ts`: one behavioral regression test for migration replay and post-migration trigger protection.
- Modify `supabase/migrations/20260425000000_drop_leftover_buckets.sql`: add only the transaction-local Storage deletion guard around the two existing deletes.
- Keep `docs/superpowers/specs/2026-08-24-storage-delete-replay-compatibility-design.md` as the approved design record.

### Task 1: Reproduce the current Storage guard failure

**Files:**
- Create: `scripts/__tests__/storage-delete-migration.integration.test.ts`
- Read: `supabase/migrations/20260425000000_drop_leftover_buckets.sql`

- [ ] **Step 1: Install the exact locked dependencies in the isolated worktree**

Run:

```powershell
bun install --frozen-lockfile
```

Expected: exit `0`, no change to `package.json` or `bun.lock`.

- [ ] **Step 2: Write the failing behavioral test**

Create `scripts/__tests__/storage-delete-migration.integration.test.ts` with:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260425000000_drop_leftover_buckets.sql",
);

it("replays the unused-bucket cleanup without leaving direct deletes enabled", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (id text PRIMARY KEY);
      CREATE TABLE storage.objects (
        bucket_id text NOT NULL,
        name text NOT NULL
      );
      CREATE FUNCTION storage.protect_delete()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
          RAISE EXCEPTION 'Direct deletion from storage tables is not allowed.'
            USING ERRCODE = '42501';
        END IF;
        RETURN NULL;
      END;
      $$;
      CREATE TRIGGER protect_buckets_delete
        BEFORE DELETE ON storage.buckets
        FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
      CREATE TRIGGER protect_objects_delete
        BEFORE DELETE ON storage.objects
        FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
      INSERT INTO storage.buckets(id)
      VALUES ('bug-attachments'), ('avatars'), ('keep');
      INSERT INTO storage.objects(bucket_id, name)
      VALUES
        ('bug-attachments', 'old-bug'),
        ('avatars', 'old-avatar'),
        ('keep', 'keep-object');
    `);

    await db.exec(readFileSync(migrationPath, "utf8"));

    expect((await db.query<{ id: string }>(
      "SELECT id FROM storage.buckets ORDER BY id",
    )).rows).toEqual([{ id: "keep" }]);
    expect((await db.query<{ bucket_id: string; name: string }>(`
      SELECT bucket_id, name FROM storage.objects ORDER BY bucket_id, name
    `)).rows).toEqual([{ bucket_id: "keep", name: "keep-object" }]);

    await expect(db.exec(
      "DELETE FROM storage.buckets WHERE id = 'keep'",
    )).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.close();
  }
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
bunx vitest run scripts/__tests__/storage-delete-migration.integration.test.ts --reporter=verbose
```

Expected: one failed test; migration execution rejects with PostgreSQL code
`42501` and the direct-deletion protection message. A syntax/import failure is
not an acceptable RED result.

- [ ] **Step 4: Commit the regression test while it is still RED**

```powershell
git add -- scripts/__tests__/storage-delete-migration.integration.test.ts
git commit -m "test(storage): reproduce protected delete replay"
```

### Task 2: Apply the minimal transaction-local migration fix

**Files:**
- Modify: `supabase/migrations/20260425000000_drop_leftover_buckets.sql`
- Test: `scripts/__tests__/storage-delete-migration.integration.test.ts`

- [ ] **Step 1: Replace only the two direct-delete statements**

Keep every policy drop unchanged. Replace the final two `DELETE` statements
with:

```sql
-- 2. Empty and drop the unused buckets under Storage's transaction-local
-- direct-delete guard. The setting is cleared automatically at transaction end.
DO $cleanup$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects
  WHERE bucket_id IN ('bug-attachments', 'avatars');
  DELETE FROM storage.buckets
  WHERE id IN ('bug-attachments', 'avatars');
END;
$cleanup$;
```

Do not drop/disable either Storage trigger, use session-global `SET`, change the
migration timestamp, or change the bucket names.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```powershell
bunx vitest run scripts/__tests__/storage-delete-migration.integration.test.ts --reporter=verbose
```

Expected: one passing test. The target rows are gone, the `keep` rows remain,
and the later unguarded delete still fails with `42501`.

- [ ] **Step 3: Verify the staging generator still copies the reviewed migration bytes**

Run:

```powershell
bunx vitest run scripts/__tests__/prepare-staging-workdir.test.ts --reporter=verbose
```

Expected: all generator tests pass and the emitted manifest continues to hash
the migration copied from Git.

- [ ] **Step 4: Commit the minimal implementation**

```powershell
git add -- supabase/migrations/20260425000000_drop_leftover_buckets.sql
git commit -m "fix(storage): allow guarded cleanup replay"
```

### Task 3: Verify and integrate the micro-fix

**Files:**
- Verify all files changed since `35e8639e`.

- [ ] **Step 1: Run repository gates**

```powershell
bun audit --audit-level=high
bun run lint
bun run knip
bun run i18n:check
bun run i18n:allowlist
bunx tsc --noEmit -p tsconfig.app.json
bunx tsc --noEmit -p tsconfig.node.json
bunx tsc --noEmit -p tsconfig.tools.json
bun run typecheck:edge
bun run test:coverage
bun run build:check
```

Expected: every command exits `0`; no blanket retry and no dependency change.

- [ ] **Step 2: Verify the source-attested release build after the final commit**

```powershell
$env:SNOTE_RELEASE_SHA = (git rev-parse HEAD).Trim()
try {
  bun run build:release
  if ($LASTEXITCODE -ne 0) { throw "Release build failed" }
  $version = Get-Content -LiteralPath "dist/version.json" -Raw | ConvertFrom-Json
  if ($version.deployedSha -ne $env:SNOTE_RELEASE_SHA) {
    throw "Release artifact SHA mismatch"
  }
} finally {
  Remove-Item Env:SNOTE_RELEASE_SHA -ErrorAction SilentlyContinue
}
```

Expected: release build exits `0` and `dist/version.json` matches `HEAD`.

- [ ] **Step 3: Obtain an independent correctness and scope review**

The reviewer must inspect only `35e8639e..HEAD` and confirm:

- the test reproduces `42501` before the fix and passes after it;
- the guard is transaction-local and precedes both deletes;
- no trigger, policy, target row, dependency, or unrelated file changed;
- the design does not introduce a port allocator or other G3B framework.

Expected: no P0-P2 finding. Fix any valid finding with another RED-to-GREEN
cycle before continuing.

- [ ] **Step 4: Push a narrow PR into the candidate branch**

```powershell
git push -u origin fix/storage-delete-replay
gh pr create `
  --base security/edge-privacy-containment `
  --head fix/storage-delete-replay `
  --title "fix(storage): replay protected bucket cleanup" `
  --body "Adds Supabase's transaction-local deletion guard to the historical unused-bucket cleanup migration, with a focused PGlite regression test. No deployment or production access."
```

Expected: a PR containing only the design, one test, and one migration change.

- [ ] **Step 5: Wait for fresh checks, then squash-merge and delete the source branch**

```powershell
$microPr = (gh pr view fix/storage-delete-replay --json number --jq '.number').Trim()
if (-not $microPr) { throw "Unable to resolve micro-PR number" }
gh pr checks $microPr --watch
if ($LASTEXITCODE -ne 0) { throw "Micro-PR checks failed" }
gh pr ready $microPr
gh pr merge $microPr --squash --delete-branch
```

Expected: `quality`, `e2e-pr`, and `extension-e2e` pass on the micro-PR head
before merge. PR #10 remains draft and unmerged.

### Task 4: Re-run the blocked G3B integration checkpoint

**Files:**
- Generate a new private workdir from the new candidate SHA.
- Do not edit source checkout files.

- [ ] **Step 1: Confirm the previous failed stack is inert**

Verify no `snote-staging-local` container exists, no
`CAPABILITY_HMAC_SECRET` environment variable exists, and no
`supabase/.temp/start-secrets` directory remains. The source checkout must be
clean.

- [ ] **Step 2: Delete only the old disposable workdir after canonical-path validation**

Resolve the old path and require that it is a direct child of
`D:\AI\Zai syrin\snote-agent\g3b-private`, its name starts with `snote-g3a-`,
and it is outside the Git checkout. Delete nothing if any assertion fails.

- [ ] **Step 3: Regenerate and attest the new workdir**

Run `bun run staging:prepare` with process-local `TEMP` and `TMP` set to the
ACL-protected private parent. Verify the manifest commit equals the new
candidate `HEAD`, every recorded SHA-256 matches, exactly 22 additive
migrations exist, atomic cutover is absent, and the production project ref is
absent.

- [ ] **Step 4: Apply only the already-proven host port override**

Append these sections to the disposable generated `supabase/config.toml` after
the manifest has been attested:

```toml
[api]
port = 55021

[db]
port = 55022

[db.pooler]
port = 55029

[studio]
port = 55023

[local_smtp]
port = 55024

[analytics]
port = 55027
```

Before startup, verify all six ports have no listener and are outside the
current Windows excluded-port ranges. Record that only generated
`supabase/config.toml` differs from its attested hash.

- [ ] **Step 5: Run the existing fail-closed G3B startup/reset procedure**

Follow the exact secret lifecycle in
`docs/security/staging-plan-2026-08.md` under “Workdir and migration
procedure”: generate one 32-byte HMAC in the child PowerShell process, discard
raw CLI output, run Supabase CLI `2.115.0` `start` then `db reset --local`,
parse local status only in memory, and clear the parent-shell HMAC in `finally`.

Expected: startup and reset exit `0`; the migration ledger contains exactly the
22 allowlisted timestamps in order. On any failure, stop the stack, remove the
runtime secret cache, redact diagnostics, and stop this plan rather than adding
another compatibility workaround.

- [ ] **Step 6: Continue the already-approved G3B probe matrix**

Resume at “Runtime sequence” in `docs/security/staging-plan-2026-08.md`. Keep
private Realtime disabled and use synthetic notes only. Completion still
requires normal teardown: restore `false,false`, stop successfully, remove the
runtime secret cache, delete the generated workdir after canonical validation,
and confirm the repository remains clean.
