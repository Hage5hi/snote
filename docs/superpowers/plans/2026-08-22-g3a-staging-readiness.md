# G3A Staging Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the candidate locally rehearsal-ready without enabling capability routes in production, applying atomic cutover, linking Supabase, or deploying anything.

**Architecture:** Keep the current legacy-only behavior as the default and let `App.tsx` opt ordinary and split note routes into the existing capability client only when `VITE_CAPABILITY_ROUTES_ENABLED` is exactly `"true"`. Generate an ephemeral Supabase CLI workdir from an explicit migration allowlist, with rewritten local identity and a hash manifest, but never execute the CLI from the generator. Correct the G3 documentation so local polling rehearsal and later hosted Realtime staging remain distinct gates.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6, Vitest 3, Bun 1.3.14, Node standard library, Supabase migration and Edge Function sources.

---

## Constraints that apply to every task

- No new dependency, feature-flag framework, migration framework, deploy wrapper, remote project, secret, or production change.
- Do not modify `Home` note creation, production environment configuration, or `20260724000000_atomic_capability_cutover.sql`.
- Test behavior before implementation. Keep each implementation commit independently reviewable.
- Generated staging files must live under the operating-system temporary directory, never under the source checkout.
- Stop before Docker, Supabase CLI execution, account creation, remote linking, deployment, PR merge, or production mutation.

### Task 1: Add a fail-closed staging route switch

**Files:**
- Modify: `scripts/__tests__/production-note-access-hotfix.test.ts`
- Modify: `src/pages/__tests__/SplitView.behavior.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/SplitView.tsx`
- Modify: `src/vite-env.d.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing route contract**

Replace the hard-coded legacy assertion with a contract that requires an exact-value build switch and requires both ordinary and split routes to receive the same fail-closed boolean:

```ts
expect(app).toContain(
  'const capabilityRoutesEnabled = import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED === "true";',
);
expect(app).toContain("<SplitView legacyOnly={!capabilityRoutesEnabled} />");
expect(app).toContain("<NotePage legacyOnly={!capabilityRoutesEnabled} />");
expect(app).not.toContain("<NotePage legacyOnly />");
```

Preserve the existing assertions that `Home` and `RawView` retain their deployed legacy paths.

- [ ] **Step 2: Write failing SplitView behavior tests**

Extend the mocked `NotePage` props with `legacyOnly?: boolean`, let `renderSplit` accept an optional boolean prop, and add two table-driven assertions:

```ts
it.each([
  [undefined, true],
  [false, false],
] as const)("forwards legacyOnly=%s to every pane", async (value, expected) => {
  renderSplit("/alpha+beta", value);
  await screen.findByText("note:alpha");
  expect(harness.noteProps.get("alpha")?.legacyOnly).toBe(expected);
  expect(harness.noteProps.get("beta")?.legacyOnly).toBe(expected);
});
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```powershell
bunx vitest run scripts/__tests__/production-note-access-hotfix.test.ts src/pages/__tests__/SplitView.behavior.test.tsx
```

Expected: failures because `App.tsx` has no exact flag check and `SplitView` cannot accept or forward the prop.

- [ ] **Step 4: Implement the smallest route change**

In `App.tsx`, define one module-level boolean:

```ts
const capabilityRoutesEnabled =
  import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED === "true";
```

Pass `legacyOnly={!capabilityRoutesEnabled}` to both `NotePage` and `SplitView`. Do not create a reusable flag helper.

In `SplitView.tsx`, add a single optional prop with a safe default and thread it through `SplitViewBody` and `SplitPane`:

```ts
type SplitViewProps = { legacyOnly?: boolean };

export default function SplitView({ legacyOnly = true }: SplitViewProps) {
  // existing route logic
}
```

Render embedded notes as `<NotePage legacyOnly={legacyOnly} ... />`.

- [ ] **Step 5: Declare and document the environment variable**

Add `VITE_CAPABILITY_ROUTES_ENABLED?: string` to `ImportMetaEnv`. Add this fail-closed example to `.env.example`:

```dotenv
# Staging-only. Capability note routes activate only for the exact value "true".
# Keep false in production until the separately approved production cutover.
VITE_CAPABILITY_ROUTES_ENABLED=false
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
bunx vitest run scripts/__tests__/production-note-access-hotfix.test.ts src/pages/__tests__/SplitView.behavior.test.tsx
bunx tsc -p tsconfig.app.json --noEmit
```

Expected: all focused tests and app typecheck pass.

- [ ] **Step 7: Commit Task 1**

```powershell
git add .env.example src/App.tsx src/pages/SplitView.tsx src/vite-env.d.ts src/pages/__tests__/SplitView.behavior.test.tsx scripts/__tests__/production-note-access-hotfix.test.ts
git commit -m "feat(staging): gate capability routes fail closed"
```

### Task 2: Generate an ephemeral allowlisted Supabase workdir

**Files:**
- Create: `scripts/prepare-staging-workdir.ts`
- Create: `scripts/__tests__/prepare-staging-workdir.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write fixture-based failing tests**

Create a temporary fake repository per test with a production-looking `supabase/config.toml`, a small `functions/` tree, and all 23 committed migration filenames. Import `prepareStagingWorkdir` and verify:

1. the output is outside the source root;
2. exactly 22 allowlisted migrations are copied in sorted order;
3. `20260724000000_atomic_capability_cutover.sql` is absent;
4. the generated config contains `project_id = "snote-staging-local"` and not `onfzjmfjldsbthchssfr`;
5. the function fixture is copied;
6. the JSON manifest records the supplied source commit, every selected filename, and the SHA-256 of its bytes;
7. a missing allowlisted migration throws before a runnable workdir is returned;
8. `supabase/.temp/project-ref` in the source tree throws before output creation;
9. a source config that cannot be rewritten throws.

Use only `node:fs`, `node:os`, `node:path`, and `node:crypto` in the test.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
bunx vitest run scripts/__tests__/prepare-staging-workdir.test.ts
```

Expected: module-not-found failure because the generator does not exist.

- [ ] **Step 3: Implement the one-purpose generator**

Create `prepare-staging-workdir.ts` with:

```ts
export type PrepareStagingWorkdirOptions = Readonly<{
  repoRoot?: string;
  tempParent?: string;
  sourceCommit?: string;
}>;

export function prepareStagingWorkdir(
  options: PrepareStagingWorkdirOptions = {},
): { workdir: string; manifestPath: string };
```

Implementation rules:

- Resolve `repoRoot` to the checkout root and default `tempParent` to `tmpdir()`.
- Reject `supabase/.temp/project-ref` and any `supabase/.branches` directory before creating output.
- Store the exact 22 approved filenames in one `as const` allowlist: the 17 base migrations through `20260427041811`, then admin rate limit, immediate containment, capability backend, checkpoint compaction, and conflict codes.
- Validate every allowlisted source path is a regular file. Reject duplicate or unexpected allowlist entries.
- Create `mkdtempSync(join(tempParent, "snote-g3a-"))`; inside it create `supabase/migrations`.
- Copy the committed `supabase/functions` directory recursively and copy only allowlisted migration files.
- Read config as text, require exactly one `project_id` assignment, rewrite it to `snote-staging-local`, and reject output containing `onfzjmfjldsbthchssfr`.
- Determine `sourceCommit` from the option or `git rev-parse HEAD` without accepting failure as an empty identity.
- Write `staging-manifest.json` with schema version `1`, source commit, excluded atomic filename, generated UTC timestamp, and an ordered migration array of `{ file, sha256 }`.
- If generation fails after creating the temp root, remove only that exact created root with `rmSync(createdRoot, { recursive: true, force: true })`, then rethrow.
- When `import.meta.main`, print the workdir and manifest path. Do not call Supabase, Docker, network commands, or any remote CLI.

- [ ] **Step 4: Add one package script**

Add:

```json
"staging:prepare": "bun run scripts/prepare-staging-workdir.ts"
```

Do not add a package or lockfile change.

- [ ] **Step 5: Run focused tests, tooling typecheck, and a real dry generation**

Run:

```powershell
bunx vitest run scripts/__tests__/prepare-staging-workdir.test.ts
bunx tsc -p tsconfig.tools.json --noEmit
bun run staging:prepare
```

Inspect the printed temp directory with read-only commands. Confirm the migration count is 22, atomic cutover is absent, config is local-only, manifest hashes recompute correctly, and `git status --short` remains unchanged.

- [ ] **Step 6: Commit Task 2**

```powershell
git add package.json scripts/prepare-staging-workdir.ts scripts/__tests__/prepare-staging-workdir.test.ts
git commit -m "feat(staging): prepare allowlisted local workdir"
```

### Task 3: Correct the G3 staging contract and status

**Files:**
- Create: `scripts/__tests__/staging-plan-contract.test.ts`
- Modify: `docs/security/staging-plan-2026-08.md`
- Modify: `docs/security-findings.md`

- [ ] **Step 1: Write a failing safety contract for the plan**

The contract reads the staging plan and requires these exact safety facts:

- G3A/G3B/G3C are distinct gates;
- G3A runs no CLI, Docker, link, deploy, or remote mutation;
- G3B uses `bun run staging:prepare`, an explicit generated `--workdir`, and local-only commands;
- the atomic migration filename is explicitly excluded and no source-tree `supabase db reset`, `migration up`, or `db push` command appears;
- runtime starts `writes=false, privateRealtime=false`, may move only to `true,false` after denial/API probes, and returns to `false,false` on failure;
- private Realtime, anonymous Auth, Turnstile, `VITE_CAPABILITY_AUTH_ENABLED`, and JWT checks belong to hosted G3C;
- X-Forwarded-For overwrite probes cover both admin login and note create/import;
- rollback on free staging uses logical dump/checksum/restore rather than promising PITR;
- the hosted desired-state inventory explicitly covers `raw`, `share-revoke`, and `verify_jwt` modes;
- evidence identity includes SPA SHA/build ID, function hashes/versions, Worker deployment/config, migration hashes, project ref/region, runtime flags, Auth mode, and redaction scan.

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```powershell
bunx vitest run scripts/__tests__/staging-plan-contract.test.ts
```

Expected: current draft fails because it conflates local and hosted staging, promises unavailable recovery, omits route activation/runtime transitions, and has stale candidate identity.

- [ ] **Step 3: Rewrite the staging plan concisely**

Replace the current draft with an operationally accurate three-gate plan:

- **G3A (this change):** repository-only route switch, workdir generator, docs and local verification; no execution of infrastructure.
- **G3B (later local approval):** Docker/Supabase CLI preflight, pinned CLI, generated workdir, exact ledger/hash checks, protected-table denials, then polling-only capability browser/API probes. Keep runtime `false,false` until denial/API probes pass; allow `true,false` only for the polling test window; restore `false,false` on any failure and at teardown.
- **G3C (separate hosted approval):** isolated free project and staging host, Turnstile + anonymous Auth, private Realtime, gateway header proof, full function desired state including `raw` and `share-revoke`, synthetic/service-role fixture provenance, logical dump/restore, edge containment, and immutable evidence.

Record the current candidate line as “starts from `75c61c46`; the immutable staging SHA is the final reviewed implementation head,” so documentation commits do not create stale exact-SHA claims.

Keep explicit NO-GO statements for atomic cutover, production, PR merge, production data, and secrets in repository/log/chat/artifacts.

- [ ] **Step 4: Update the finding status without claiming G3 complete**

In `docs/security-findings.md`, retain G2 closure at `f712a99c`, note that the G3 plan-only commit is `75c61c46`, and state that G3A readiness implementation does not constitute staging evidence or deployment.

- [ ] **Step 5: Run the documentation contract and link checks**

Run:

```powershell
bunx vitest run scripts/__tests__/staging-plan-contract.test.ts
git diff --check
```

Expected: contract passes and no whitespace errors exist.

- [ ] **Step 6: Commit Task 3**

```powershell
git add docs/security/staging-plan-2026-08.md docs/security-findings.md scripts/__tests__/staging-plan-contract.test.ts
git commit -m "docs(security): separate local and hosted staging gates"
```

### Task 4: Verify, simplify, review, and prepare the stacked PR

**Files:**
- Review only: all files changed by Tasks 1–3
- Update only if required by verified failures: directly affected files above

- [ ] **Step 1: Run the complete local quality gates**

Run, stopping on the first genuine failure:

```powershell
bun install --frozen-lockfile
bun run lint
bun run knip
bun run i18n:check
bun run i18n:audit
bun run i18n:allowlist
bunx tsc -p tsconfig.app.json --noEmit
bunx tsc -p tsconfig.node.json --noEmit
bunx tsc -p tsconfig.tools.json --noEmit
bun run typecheck:edge
bun run test:coverage
bun run build:check
bun audit --audit-level=high
```

Do not “fix” unrelated pre-existing failures. Diagnose first and record anything outside scope.

- [ ] **Step 2: Run the exact-SHA release build from a clean commit**

Commit any verified in-scope correction, confirm `git status --short` is empty, then run:

```powershell
$releaseSha = git rev-parse HEAD
$env:SNOTE_RELEASE_SHA = $releaseSha
bun run build:release
Remove-Item Env:SNOTE_RELEASE_SHA
```

Verify `dist/version.json` reports the same SHA. Do not deploy the artifact.

- [ ] **Step 3: Perform a deletion-focused review**

Use `ponytail-review` on `git diff 75c61c46...HEAD`. Remove only confirmed unnecessary abstractions or duplication. Specifically reject any suggestion to add a flag service, migration abstraction, remote deployment wrapper, or generalized evidence framework.

- [ ] **Step 4: Request an independent correctness/security review**

Review the final diff against the approved design. Required review questions:

1. Can any missing/malformed flag enable capability routes?
2. Can the generator copy or apply atomic cutover, retain the production project reference, use ambient linkage, or mutate the repository?
3. Does any new code execute Docker, Supabase, network, or deployment commands?
4. Do the docs overclaim local Realtime, PITR, exact release identity, or G3 completion?

Resolve only P0–P2 findings in scope; do not start a fresh P3 hunt.

- [ ] **Step 5: Publish a stacked draft PR, but do not merge**

Push the implementation branch and open a draft PR targeting `security/edge-privacy-containment`. The PR description must include scope, RED→GREEN evidence, exact final SHA, migration allowlist/exclusion, generated-workdir dry-run evidence, all local gate results, explicit “no deploy/no production mutation,” rollback (delete temp workdir and revert the three commits), and a link to the approved design.

Do not merge PR #10 or the stacked PR. Do not start G3B until the user separately approves execution after review.

