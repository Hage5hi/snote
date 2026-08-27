# Privacy Runtime Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three confirmed privacy/runtime gaps on current `main` without importing PR #10's obsolete history or test harnesses.

**Architecture:** Make three independent, reviewable commits: remove the URL-fragment debug subsystem, align legacy sharing UI with the existing `410` tombstone, and make one historical Storage cleanup migration replayable under its guard. Each behavior starts with a focused failing regression and ends with its focused suite green.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Supabase SQL migrations, PGlite, Bun 1.3.14.

---

## File map

- `scripts/__tests__/application-log-privacy.test.ts`: contract proving the fragment-debug subsystem is absent.
- `src/App.tsx`: remove the debug panel mount.
- `src/components/dev/UrlSanitizeDebugPanel.tsx`: delete the unsafe debug UI.
- `src/lib/url-sanitize.ts`: delete the helper used only by that UI.
- `src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx`: retain only the Diagnostics panel guard.
- `src/lib/__tests__/url-sanitize.test.ts`: delete tests for the removed subsystem.
- `src/components/note/ShareDialog.tsx`: hide dead legacy share creation while preserving existing-token copy/revoke and capability-owner rotation.
- `src/components/note/__tests__/ShareDialog.legacy-url.test.tsx`: regress legacy and capability-owner visibility.
- `src/lib/share-tokens.ts`: remove the now-unused legacy token writer.
- `src/i18n/locales/{de,en,es,fr,ja,ko,pt,vi,zh}.ts`: remove the stale promise that every note can create a read-only link.
- `scripts/__tests__/storage-delete-migration.integration.test.ts`: replay the real migration against a guarded PGlite schema.
- `supabase/migrations/20260425000000_drop_leftover_buckets.sql`: enable the existing delete guard transaction-locally.

### Task 1: Remove the fragment-debug subsystem

- [ ] **Step 1: Write the failing privacy contract**

In `scripts/__tests__/application-log-privacy.test.ts`, add `existsSync` to the Node filesystem import and append:

```ts
it("does not ship a panel that can log URL fragments", () => {
  const app = source("src/App.tsx");

  expect(app).not.toContain("UrlSanitizeDebugPanel");
  expect(existsSync(resolve(
    process.cwd(),
    "src/components/dev/UrlSanitizeDebugPanel.tsx",
  ))).toBe(false);
  expect(existsSync(resolve(process.cwd(), "src/lib/url-sanitize.ts"))).toBe(false);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
bunx vitest run scripts/__tests__/application-log-privacy.test.ts
```

Expected: the new test fails because `App.tsx` still mounts `UrlSanitizeDebugPanel` and both files still exist.

- [ ] **Step 3: Apply the minimal removal**

In `src/App.tsx`, remove only:

```ts
import { UrlSanitizeDebugPanel } from "./components/dev/UrlSanitizeDebugPanel";
```

and:

```tsx
<UrlSanitizeDebugPanel />
```

Delete `src/components/dev/UrlSanitizeDebugPanel.tsx`, `src/lib/url-sanitize.ts`, and `src/lib/__tests__/url-sanitize.test.ts`.

In `src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx`:

- change the header to `// Guards that the dev overlay panels stay hidden in prod-like builds.`;
- remove `beforeEach`, `MemoryRouter`, and `UrlSanitizeDebugPanel` imports;
- reduce `KEYS` to `['DEV', 'VITE_DEBUG_DIAGNOSTICS_PANEL']`;
- delete the complete `UrlSanitizeDebugPanel prod-build guard` describe block.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
bunx vitest run scripts/__tests__/application-log-privacy.test.ts src/components/dev/__tests__/DebugPanels.prod-guard.test.tsx
```

Expected: both files pass with no warning or error output.

- [ ] **Step 5: Commit**

```powershell
git add --all -- scripts/__tests__/application-log-privacy.test.ts src/App.tsx src/components/dev src/lib/url-sanitize.ts src/lib/__tests__/url-sanitize.test.ts
git commit -m "fix(privacy): remove URL fragment debug panel"
```

### Task 2: Align legacy share UI with the tombstoned endpoint

- [ ] **Step 1: Write failing visibility regressions**

Append to `src/components/note/__tests__/ShareDialog.legacy-url.test.tsx`:

```tsx
describe("ShareDialog share-create tombstone alignment", () => {
  beforeEach(() => {
    harness.qr.mockClear();
    harness.copy.mockClear();
    harness.shareToken = null;
    harness.openDialog = null;
  });

  it("offers no legacy read-only link creation without a stored token", async () => {
    window.history.replaceState(null, "", "/secret");
    render(
      <ShareDialog
        slug="secret"
        isEncrypted={false}
        currentShareUrl={`${window.location.origin}/secret`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "share.create_btn" })).toBeNull(),
    );
    expect(screen.queryByText("share.readonly_heading")).toBeNull();
  });

  it("still offers read-only link creation to capability owners", async () => {
    render(
      <ShareDialog
        slug="secret"
        isEncrypted={false}
        capabilityAccess={{ slug: "secret", scope: "owner", token: "a".repeat(43) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.aria" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "share.create_btn" })).toBeDefined(),
    );
    expect(screen.getByText("share.readonly_heading")).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
bunx vitest run src/components/note/__tests__/ShareDialog.legacy-url.test.tsx
```

Expected: the legacy test fails because the create button and read-only section are still rendered.

- [ ] **Step 3: Implement the smallest UI change**

In `src/components/note/ShareDialog.tsx`:

- import only `getShareToken` and `clearShareToken` from `@/lib/share-tokens`;
- replace `createLink` with:

```ts
const createLink = async () => {
  if (capabilityAccess?.scope !== "owner") return;
  setBusy("create");
  try {
    const data = await createCapabilityApi().manage(capabilityAccess.token, {
      action: "rotate",
      scope: "view",
    });
    const rotated = data.rotated as { scope?: unknown; capability?: unknown } | undefined;
    if (
      rotated?.scope !== "view"
      || typeof rotated.capability !== "string"
      || !CAPABILITY_TOKEN_RE.test(rotated.capability)
    ) {
      throw new Error("invalid rotated capability");
    }
    setToken(rotated.capability);
    toast({ title: t("share.created_link") });
  } catch (e) {
    console.error(e);
    toast({ title: t("share.create_failed"), description: String(e) });
  } finally {
    setBusy(null);
  }
};
```

- replace the current read-only-section condition
  `(!capabilityAccess || capabilityAccess.scope === "owner")` with
  `(capabilityAccess?.scope === "owner" || (!capabilityAccess && shareToken))`.

Delete `setShareToken` from `src/lib/share-tokens.ts` and remove it from the test mock.

- [ ] **Step 4: Correct localized dialog copy**

Change only `share.dialog_desc` in the nine locale files to these exact values:

```ts
// de
"share.dialog_desc": "Scanne den QR-Code mit deinem Handy, um die Notiz zu öffnen.",
// en, es, fr, ja, ko, zh
"share.dialog_desc": "Scan the QR with your phone to open the note.",
// pt
"share.dialog_desc": "Leia o QR com o seu telemóvel para abrir a nota.",
// vi
"share.dialog_desc": "Quét QR bằng điện thoại để mở note nhanh.",
```

- [ ] **Step 5: Verify GREEN and localization integrity**

Run:

```powershell
bunx vitest run src/components/note/__tests__/ShareDialog.legacy-url.test.tsx
bun run i18n:check
bun run i18n:allowlist
```

Expected: all commands pass; capability owners can still create view capabilities and legacy stored tokens remain copyable/revocable.

- [ ] **Step 6: Commit**

```powershell
git add -- src/components/note/ShareDialog.tsx src/components/note/__tests__/ShareDialog.legacy-url.test.tsx src/lib/share-tokens.ts src/i18n/locales
git commit -m "fix(share): stop offering tombstoned legacy links"
```

### Task 3: Make the Storage cleanup migration replayable

- [ ] **Step 1: Add the focused PGlite regression**

Create `scripts/__tests__/storage-delete-migration.integration.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260425000000_drop_leftover_buckets.sql",
  ),
  "utf8",
);

it("replays leftover bucket cleanup through Storage delete protection", async () => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (id text PRIMARY KEY);
      CREATE TABLE storage.objects (bucket_id text, name text);

      CREATE FUNCTION storage.protect_delete()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
          RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
        END IF;
        RETURN NULL;
      END;
      $$;

      CREATE TRIGGER protect_buckets_delete
        BEFORE DELETE ON storage.buckets
        FOR EACH STATEMENT
        EXECUTE FUNCTION storage.protect_delete();
      CREATE TRIGGER protect_objects_delete
        BEFORE DELETE ON storage.objects
        FOR EACH STATEMENT
        EXECUTE FUNCTION storage.protect_delete();

      INSERT INTO storage.buckets (id) VALUES
        ('bug-attachments'),
        ('avatars'),
        ('keep');
      INSERT INTO storage.objects (bucket_id, name) VALUES
        ('bug-attachments', 'bug.txt'),
        ('avatars', 'avatar.png'),
        ('keep', 'keep.txt');
    `);

    await db.exec(migration);

    expect((await db.query<{ id: string }>(
      "SELECT id FROM storage.buckets ORDER BY id",
    )).rows).toEqual([{ id: "keep" }]);
    expect((await db.query<{ bucket_id: string; name: string }>(
      "SELECT bucket_id, name FROM storage.objects ORDER BY bucket_id, name",
    )).rows).toEqual([{ bucket_id: "keep", name: "keep.txt" }]);

    await expect(db.exec("DELETE FROM storage.buckets WHERE id = 'keep'"))
      .rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.close();
  }
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
bunx vitest run scripts/__tests__/storage-delete-migration.integration.test.ts
```

Expected: FAIL with PostgreSQL code `42501` while the existing migration tries to delete guarded rows.

- [ ] **Step 3: Apply the transaction-local SQL guard**

Replace the two unguarded deletes in `supabase/migrations/20260425000000_drop_leftover_buckets.sql` with:

```sql
-- 2. Allow this migration's cleanup deletes for the current transaction only.
DO $cleanup$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  -- Empty the buckets (if any objects snuck in).
  DELETE FROM storage.objects WHERE bucket_id IN ('bug-attachments', 'avatars');

  -- 3. Drop the buckets.
  DELETE FROM storage.buckets WHERE id IN ('bug-attachments', 'avatars');
END;
$cleanup$;
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
bunx vitest run scripts/__tests__/storage-delete-migration.integration.test.ts
```

Expected: PASS; target rows are removed, `keep` survives, and a subsequent delete is denied with `42501`.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/__tests__/storage-delete-migration.integration.test.ts supabase/migrations/20260425000000_drop_leftover_buckets.sql
git commit -m "fix(storage): replay protected bucket cleanup"
```

### Task 4: Verify and prepare the micro-PR

- [ ] **Step 1: Install reproducibly**

```powershell
bun install --frozen-lockfile
```

Expected: success without changing `package.json` or `bun.lock`.

- [ ] **Step 2: Run repository quality gates**

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

Expected: every command exits `0`; the full test suite has no failures and the bundle-size gate passes.

- [ ] **Step 3: Review the exact delta**

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: only the spec, this plan, and the three scoped fixes appear; no lockfile, Worker, deployment, or generated artifact changes.

- [ ] **Step 4: Request code review before push/merge**

Use the repository review workflow on the exact final SHA. Push and create a PR only after the review finds no correctness or security blocker. Do not deploy or close PR #10 until this replacement PR is green.
