# Worker Production Source Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `main` reproduce the Cloudflare Worker source and non-secret configuration already verified and deployed during G4, without changing cloud state.

**Architecture:** Reconstruct one Worker-only concern on a fresh worktree from the approved design branch. A small contract test pins the reviewed Worker source identity and current production-safe Wrangler settings; the existing behavioral suites from `8382c5bb` protect the runtime boundary. No historical PR #10 framework or unrelated file is imported.

**Tech Stack:** Cloudflare Workers JavaScript, Wrangler TOML, Vitest, Bun, TypeScript, GitHub Actions.

---

## File map

- Create `scripts/__tests__/worker-production-source-parity.test.ts`: cross-platform normalized source hash and non-secret production-config contract.
- Replace `cloudflare-worker/worker.js`: exact reviewed Worker source from Git commit `8382c5bba8b342fbc5d63b08377e6a7d1b3088df`.
- Create `cloudflare-worker/worker.edge-privacy.test.ts`: reviewed origin, authority, privacy, analytics, method and PWA behavior suite from the same commit.
- Replace `cloudflare-worker/worker.share-containment.test.ts`: reviewed crawler/share containment suite from the same commit.
- Modify `cloudflare-worker/wrangler.toml`: current G4 non-secret production configuration.
- Modify `cloudflare-worker/README.md`: concise source-of-truth and deploy-checkpoint wording.
- Keep `supabase/.temp/` untouched and untracked.

### Task 1: Establish the failing production-parity contract

**Files:**
- Create: `scripts/__tests__/worker-production-source-parity.test.ts`

- [ ] **Step 1: Create an isolated worktree from the design branch**

Use the `using-git-worktrees` skill. Create branch
`fix/worker-production-source-parity` from the committed HEAD of
`chore/worker-production-source-parity` in the existing ignored worktree area.
Confirm the source checkout still contains only the pre-existing untracked
`supabase/.temp/` and do not copy that directory into the new worktree.

- [ ] **Step 2: Install the pinned dependency graph and verify the baseline**

Run:

```powershell
bun install --frozen-lockfile
bunx vitest run cloudflare-worker/worker.share-containment.test.ts
```

Expected: frozen install succeeds and the existing Worker suite passes before
the parity contract is added.

- [ ] **Step 3: Write the failing parity test**

Create the file with this complete contract:

```ts
/** @vitest-environment node */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8").replaceAll("\r\n", "\n");
}

describe("deployed Worker source parity", () => {
  it("pins the reviewed G4 Worker source", () => {
    const digest = createHash("sha256")
      .update(source("cloudflare-worker/worker.js"))
      .digest("hex");

    expect(digest).toBe(
      "ee1cec6d4dac7803c2ba4a1eeecc910c6473d236eca5f733156ae7c49d4c9b3b",
    );
  });

  it("records the current non-secret production routing boundary", () => {
    const config = source("cloudflare-worker/wrangler.toml");

    expect(config).toMatch(/^name\s*=\s*"syrin-prerender"$/m);
    expect(config).toMatch(/^main\s*=\s*"worker\.js"$/m);
    expect(config).toMatch(/^workers_dev\s*=\s*false$/m);
    expect(config).toMatch(/^preview_urls\s*=\s*false$/m);
    expect(config).toContain('ORIGIN_HOST = "snote-g4-origin.pages.dev"');
    expect(config).toContain('SITE_URL = "https://note.syrin.online"');

    for (const route of [
      "note.syrin.online/*",
      "syrin.online/*",
      "www.syrin.online/*",
    ]) {
      expect(config.match(new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
        .toHaveLength(1);
    }

    expect(config).toMatch(/\[observability\]\s+enabled\s*=\s*false/);
    expect(config).toMatch(
      /\[observability\.logs\]\s+enabled\s*=\s*false\s+invocation_logs\s*=\s*false/,
    );
    expect(config).toMatch(/\[observability\.traces\]\s+enabled\s*=\s*false/);
    expect(config).not.toMatch(/SUPABASE_(?:ANON_KEY|PUBLISHABLE_KEY)|NOTE_META_SECRET/);
  });
});
```

- [ ] **Step 4: Run the contract and verify RED**

Run:

```powershell
bunx vitest run scripts/__tests__/worker-production-source-parity.test.ts
```

Expected: both tests fail because the old Worker hash differs and the old
Wrangler config still uses `snote.lovable.app`, lacks `preview_urls = false`,
and enables top-level observability. A syntax or import error is not an accepted
RED result.

### Task 2: Transplant the exact reviewed Worker concern

**Files:**
- Replace: `cloudflare-worker/worker.js`
- Create: `cloudflare-worker/worker.edge-privacy.test.ts`
- Replace: `cloudflare-worker/worker.share-containment.test.ts`
- Modify: `cloudflare-worker/wrangler.toml`
- Modify: `cloudflare-worker/README.md`
- Test: `scripts/__tests__/worker-production-source-parity.test.ts`

- [ ] **Step 1: Read immutable source blobs**

Read these three blobs from
`8382c5bba8b342fbc5d63b08377e6a7d1b3088df`:

```powershell
git show 8382c5bba8b342fbc5d63b08377e6a7d1b3088df:cloudflare-worker/worker.js
git show 8382c5bba8b342fbc5d63b08377e6a7d1b3088df:cloudflare-worker/worker.edge-privacy.test.ts
git show 8382c5bba8b342fbc5d63b08377e6a7d1b3088df:cloudflare-worker/worker.share-containment.test.ts
```

Use `apply_patch` to replace/create the three files with those exact blob
contents. Do not use `git checkout`, redirect output into files, or import any
other path from that commit.

- [ ] **Step 2: Record the current production-safe Wrangler configuration**

Replace `cloudflare-worker/wrangler.toml` with:

```toml
name = "syrin-prerender"
main = "worker.js"
compatibility_date = "2024-11-01"
workers_dev = false
preview_urls = false

routes = [
  { pattern = "note.syrin.online/*", zone_name = "syrin.online" },
  { pattern = "syrin.online/*", zone_name = "syrin.online" },
  { pattern = "www.syrin.online/*", zone_name = "syrin.online" },
]

[vars]
ORIGIN_HOST = "snote-g4-origin.pages.dev"
SITE_URL = "https://note.syrin.online"

[observability]
enabled = false

[observability.logs]
enabled = false
invocation_logs = false

[observability.traces]
enabled = false
```

- [ ] **Step 3: Correct only the stale operational statements in the README**

Use `apply_patch` to make these points explicit without rewriting the document:

```markdown
The source and non-secret configuration in this directory match the Worker
verified during G4. This does not authorize a new deployment.

The reviewed origin is `snote-g4-origin.pages.dev`; `snote.lovable.app` is not
an origin or rollback target.

All Worker observability, invocation logs, traces, `workers.dev`, and preview
URLs remain disabled. Existing provider-managed secret bindings are not stored
in this repository.
```

Update its embedded TOML example to match the committed config. Retain the
existing cache-purge, privacy, minimum-probe, and rollback guidance.

- [ ] **Step 4: Verify source identity before running tests**

Run:

```powershell
bun -e 'import { readFileSync } from "node:fs"; import { createHash } from "node:crypto"; const source = readFileSync("cloudflare-worker/worker.js", "utf8").replaceAll("\r\n", "\n"); console.log(createHash("sha256").update(source).digest("hex"));'
```

Expected exact output:

```text
ee1cec6d4dac7803c2ba4a1eeecc910c6473d236eca5f733156ae7c49d4c9b3b
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
bunx vitest run `
  scripts/__tests__/worker-production-source-parity.test.ts `
  cloudflare-worker/worker.edge-privacy.test.ts `
  cloudflare-worker/worker.share-containment.test.ts
```

Expected: three test files pass with zero failed tests. The two reviewed Worker
suites should contribute 299 passing cases; the parity suite adds two.

- [ ] **Step 6: Commit the complete Worker concern**

```powershell
git add -- `
  scripts/__tests__/worker-production-source-parity.test.ts `
  cloudflare-worker/worker.js `
  cloudflare-worker/worker.edge-privacy.test.ts `
  cloudflare-worker/worker.share-containment.test.ts `
  cloudflare-worker/wrangler.toml `
  cloudflare-worker/README.md
git diff --cached --check
git commit -m "fix(edge): reconcile deployed worker source"
```

Expected: one focused implementation commit; no `supabase/.temp/`, generated
artifact, secret, private evidence file, or unrelated PR #10 path is staged.

### Task 3: Run release-quality verification and independent review

**Files:**
- Verify only; modify a file only if a failing gate identifies a real defect in
  this concern, then use a new RED-GREEN cycle and a separate fix commit.

- [ ] **Step 1: Run static and dependency gates**

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
```

Expected: every command exits `0`; audit reports no high-severity finding.

- [ ] **Step 2: Run full unit coverage and ordinary production build**

```powershell
bun run test:coverage
bun run build:check
```

Expected: all test files pass, coverage completes, Vite build succeeds, and the
bundle-size gate passes.

- [ ] **Step 3: Verify a strict, capability-disabled release artifact**

```powershell
$env:SNOTE_RELEASE_SHA = (git rev-parse HEAD)
$env:VITE_CAPABILITY_ROUTES_ENABLED = "false"
bun run build:release
bun -e 'const v = await Bun.file("dist/version.json").json(); if (v.deployedSha !== process.env.SNOTE_RELEASE_SHA || v.capabilityRoutesEnabled !== false) process.exit(1);'
Remove-Item Env:SNOTE_RELEASE_SHA,Env:VITE_CAPABILITY_ROUTES_ENABLED
```

Expected: the strict build succeeds and `dist/version.json` attests the exact
HEAD with capability routes disabled. This artifact is verification-only and
must not be uploaded.

- [ ] **Step 4: Scan the exact diff for accidental sensitive material**

```powershell
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
git diff --no-ext-diff origin/main...HEAD -- `
  cloudflare-worker scripts/__tests__/worker-production-source-parity.test.ts | `
  rg -n -i 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY\s*=|CLOUDFLARE_API_TOKEN\s*=|ADMIN_PASSPHRASE\s*=|CAPABILITY_HMAC_SECRET\s*=|eyJ[A-Za-z0-9_-]{20,}'
```

Expected: `diff --check` passes; the changed paths are limited to the approved
spec, plan, Worker files, README and parity test; the secret scan has no match.

- [ ] **Step 5: Request independent reviews**

Dispatch one correctness/security reviewer and one over-engineering reviewer.
The first must compare `worker.js` to `8382c5bb`, the config to the G4 evidence,
and the diff to the approved scope. The second must report only removable
complexity introduced by this PR. Resolve P0-P2 findings with TDD; do not expand
scope for speculative P3 suggestions.

### Task 4: Publish a focused GitHub PR without deploying

**Files:**
- Git/GitHub metadata only.

- [ ] **Step 1: Push the feature branch**

```powershell
git push -u origin fix/worker-production-source-parity
```

Expected: push succeeds without modifying `main` or any cloud provider.

- [ ] **Step 2: Open the PR**

Use this body:

```markdown
## Summary

- reconcile `main` with the Worker source already reviewed and deployed in G4
- record the current non-secret Pages origin/routes/observability settings
- restore the focused containment and production-parity contracts

## Identity

- deployed source commit: `8382c5bba8b342fbc5d63b08377e6a7d1b3088df`
- normalized Worker SHA-256: `ee1cec6d4dac7803c2ba4a1eeecc910c6473d236eca5f733156ae7c49d4c9b3b`
- origin: `snote-g4-origin.pages.dev`

## Boundary

Repository reconciliation only. No Worker/Pages/DNS/Supabase/Lovable deploy,
secret access, cache purge, route mutation, frontend publish, capability
activation, or atomic cutover was performed.

## Verification

- Worker parity and containment suites
- audit, lint, Knip, i18n and all typechecks
- full coverage and build/bundle gate
- strict exact-SHA build with capability routes disabled
- independent correctness/security and over-engineering review
```

Expected: a non-draft PR targeting `main`, containing only the approved files.

- [ ] **Step 3: Wait for required checks**

Wait for `quality`, `e2e-pr`, and `extension-e2e` on the exact PR head. Do not
rerun a failed check without identifying its cause; fix code in a new commit if
needed.

- [ ] **Step 4: Stop at the merge checkpoint**

Report the PR URL, exact head SHA, local evidence, independent-review outcome,
and required-check results. Do not merge the PR and do not deploy anything
until the owner gives the next explicit instruction.
