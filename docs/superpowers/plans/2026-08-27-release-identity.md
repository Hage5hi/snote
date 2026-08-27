# Source-attested Release Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict frontend release-build path whose `version.json` attests the exact clean Git commit, without changing application behavior or deploying anything.

**Architecture:** A dependency-free helper validates a caller-approved SHA against a clean Git `HEAD` and revalidates it at bundle emission. Vite writes that SHA only for the strict release path; ordinary builds explicitly write `deployedSha: null`. CI runs and verifies the strict path on every candidate SHA.

**Tech Stack:** Bun 1.3.14, TypeScript, Vite 6, Vitest 3, GitHub Actions.

---

### Task 1: Implement the release-identity helper with TDD

**Files:**
- Create: `scripts/release-identity.ts`
- Create: `scripts/__tests__/release-identity.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  resolveReleaseIdentity,
  revalidateReleaseIdentity,
  type GitCommand,
} from "../release-identity";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sequence(outputs: Array<string | Error>): GitCommand {
  let index = 0;
  return () => {
    const value = outputs[index++];
    if (value instanceof Error) throw value;
    return value ?? "";
  };
}

describe("release identity", () => {
  it("leaves ordinary builds explicitly unattested", () => {
    expect(resolveReleaseIdentity({}, sequence([]))).toEqual({
      strict: false,
      deployedSha: null,
    });
  });

  it("accepts an exact approved SHA from a clean matching checkout", () => {
    expect(
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([`${SHA_A}\n`, ""]),
      ),
    ).toEqual({ strict: true, deployedSha: SHA_A });
  });

  it.each([
    [{ SNOTE_REQUIRE_RELEASE_SHA: "1" }, /requires SNOTE_RELEASE_SHA/],
    [{ SNOTE_REQUIRE_RELEASE_SHA: "0", SNOTE_RELEASE_SHA: SHA_A }, /omitted or exactly/],
    [{ SNOTE_RELEASE_SHA: SHA_A }, /only accepted/],
    [{ SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: "ABC" }, /40-character/],
  ])("rejects partial or malformed configuration", (env, message) => {
    expect(() => resolveReleaseIdentity(env, sequence([]))).toThrow(message);
  });

  it("rejects a dirty checkout", () => {
    expect(() =>
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([`${SHA_A}\n`, " M vite.config.ts\n"]),
      ),
    ).toThrow(/clean Git checkout/);
  });

  it("rejects a SHA that differs from HEAD", () => {
    expect(() =>
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([`${SHA_B}\n`, ""]),
      ),
    ).toThrow(/does not match/);
  });

  it("fails closed when Git is unavailable", () => {
    expect(() =>
      resolveReleaseIdentity(
        { SNOTE_REQUIRE_RELEASE_SHA: "1", SNOTE_RELEASE_SHA: SHA_A },
        sequence([new Error("git unavailable")]),
      ),
    ).toThrow(/clean Git checkout/);
  });

  it("revalidates the identity immediately before bundle emission", () => {
    const identity = { strict: true as const, deployedSha: SHA_A };
    expect(
      revalidateReleaseIdentity(identity, sequence([`${SHA_A}\n`, ""])),
    ).toBe(SHA_A);
    expect(() =>
      revalidateReleaseIdentity(identity, sequence([`${SHA_B}\n`, ""])),
    ).toThrow(/changed during the build/);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `bunx vitest run scripts/__tests__/release-identity.test.ts`

Expected: FAIL because `scripts/release-identity.ts` does not exist.

- [ ] **Step 3: Add a compiling stub and verify the intended RED failure**

```ts
export type GitCommand = (args: readonly string[]) => string;
export type ReleaseIdentity = {
  strict: boolean;
  deployedSha: string | null;
};

export function resolveReleaseIdentity(): ReleaseIdentity {
  throw new Error("not implemented");
}

export function revalidateReleaseIdentity(): string | null {
  throw new Error("not implemented");
}
```

Run: `bunx vitest run scripts/__tests__/release-identity.test.ts`

Expected: FAIL with `not implemented`, proving the tests reach the wished-for API.

- [ ] **Step 4: Replace the stub with the minimal implementation**

```ts
import { execFileSync } from "node:child_process";

export type GitCommand = (args: readonly string[]) => string;
export type ReleaseEnvironment = {
  SNOTE_REQUIRE_RELEASE_SHA?: string;
  SNOTE_RELEASE_SHA?: string;
};
export type ReleaseIdentity = {
  strict: boolean;
  deployedSha: string | null;
};

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function runGit(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCleanHead(run: GitCommand): string | null {
  try {
    const head = run(["rev-parse", "HEAD"]).trim();
    if (!COMMIT_SHA.test(head)) return null;
    const status = run(["status", "--porcelain", "--untracked-files=all"]);
    return status === "" ? head : null;
  } catch {
    return null;
  }
}

export function resolveReleaseIdentity(
  env: ReleaseEnvironment = process.env,
  git: GitCommand = runGit,
): ReleaseIdentity {
  const required = env.SNOTE_REQUIRE_RELEASE_SHA;
  const requested = env.SNOTE_RELEASE_SHA?.trim();

  if (required === undefined && requested === undefined) {
    return { strict: false, deployedSha: null };
  }
  if (required !== "1") {
    if (requested !== undefined && required === undefined) {
      throw new Error("SNOTE_RELEASE_SHA is only accepted by a strict release build.");
    }
    throw new Error('SNOTE_REQUIRE_RELEASE_SHA must be omitted or exactly "1".');
  }
  if (!requested) {
    throw new Error("SNOTE_REQUIRE_RELEASE_SHA=1 requires SNOTE_RELEASE_SHA.");
  }
  if (!COMMIT_SHA.test(requested)) {
    throw new Error("SNOTE_RELEASE_SHA must be an exact 40-character lowercase commit SHA.");
  }

  const head = resolveCleanHead(git);
  if (head === null) {
    throw new Error("A strict release build requires a clean Git checkout.");
  }
  if (head !== requested) {
    throw new Error("SNOTE_RELEASE_SHA does not match checked-out HEAD.");
  }
  return { strict: true, deployedSha: head };
}

export function revalidateReleaseIdentity(
  identity: ReleaseIdentity,
  git: GitCommand = runGit,
): string | null {
  if (!identity.strict) return null;
  const head = resolveCleanHead(git);
  if (head === null || head !== identity.deployedSha) {
    throw new Error("Strict release identity changed during the build.");
  }
  return head;
}
```

- [ ] **Step 5: Run focused tests and tools typecheck**

Run:

```powershell
bunx vitest run scripts/__tests__/release-identity.test.ts
bunx tsc --noEmit -p tsconfig.tools.json
```

Expected: helper tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the helper**

```powershell
git add scripts/release-identity.ts scripts/__tests__/release-identity.test.ts
git commit -m "build: validate release source identity"
```

### Task 2: Wire strict identity into Vite and the build entry point

**Files:**
- Create: `scripts/build-release.ts`
- Create: `scripts/__tests__/release-build-contract.test.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing wiring contract**

```ts
/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release build wiring", () => {
  it("exposes the strict entry point and emits deployedSha", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const config = readFileSync("vite.config.ts", "utf8");

    expect(pkg.scripts["build:release"]).toBe(
      "bun run scripts/build-release.ts",
    );
    expect(config).toContain("resolveReleaseIdentity");
    expect(config).toContain("revalidateReleaseIdentity");
    expect(config).toContain("deployedSha");
  });
});
```

- [ ] **Step 2: Run the wiring test to verify RED**

Run: `bunx vitest run scripts/__tests__/release-build-contract.test.ts`

Expected: FAIL because `build:release` and `deployedSha` are absent.

- [ ] **Step 3: Add the cross-platform strict build script**

```ts
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  {
    env: { ...process.env, SNOTE_REQUIRE_RELEASE_SHA: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
```

- [ ] **Step 4: Add the package entry point**

Add beside the existing `build` script in `package.json`:

```json
"build:release": "bun run scripts/build-release.ts"
```

- [ ] **Step 5: Add strict attestation to `vite.config.ts`**

Add the import:

```ts
import {
  resolveReleaseIdentity,
  revalidateReleaseIdentity,
} from "./scripts/release-identity";
```

Resolve identity once beside `BUILD_ID`:

```ts
const RELEASE_IDENTITY = resolveReleaseIdentity();
```

At the start of `generateBundle()`, revalidate it and extend the emitted JSON:

```ts
const deployedSha = revalidateReleaseIdentity(RELEASE_IDENTITY);
this.emitFile({
  type: "asset",
  fileName: "version.json",
  source: JSON.stringify({
    buildId: BUILD_ID,
    builtAt: new Date().toISOString(),
    deployedSha,
  }),
});
```

- [ ] **Step 6: Verify GREEN and ordinary-build compatibility**

Run:

```powershell
bunx vitest run scripts/__tests__/release-identity.test.ts scripts/__tests__/release-build-contract.test.ts
bun run build:check
bun -e 'const value = await Bun.file("dist/version.json").json(); if (value.deployedSha !== null) throw new Error("ordinary build must remain unattested");'
```

Expected: tests PASS, build exits 0, ordinary `deployedSha` is exactly `null`.

- [ ] **Step 7: Commit the Vite wiring**

```powershell
git add package.json vite.config.ts scripts/build-release.ts scripts/__tests__/release-build-contract.test.ts
git commit -m "build: stamp strict release artifacts"
```

### Task 3: Exercise the strict artifact in CI

**Files:**
- Modify: `scripts/__tests__/release-build-contract.test.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Extend the contract test first**

Add inside the existing test:

```ts
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
expect(ci).toContain("SNOTE_RELEASE_SHA: ${{ github.sha }}");
expect(ci).toContain("bun run build:release");
expect(ci).toContain("release version artifact must attest checked-out SHA");
```

- [ ] **Step 2: Run the test to verify RED**

Run: `bunx vitest run scripts/__tests__/release-build-contract.test.ts`

Expected: FAIL because CI does not yet run `build:release`.

- [ ] **Step 3: Add one non-deploying CI step after `build:check`**

```yaml
      - name: Verify source-attested release build
        env:
          SNOTE_RELEASE_SHA: ${{ github.sha }}
        run: |
          bun run build:release
          bun -e 'const { deployedSha } = await Bun.file("dist/version.json").json(); if (deployedSha !== process.env.SNOTE_RELEASE_SHA) throw new Error("release version artifact must attest checked-out SHA");'
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `bunx vitest run scripts/__tests__/release-build-contract.test.ts`

Expected: PASS.

```powershell
git add .github/workflows/ci.yml scripts/__tests__/release-build-contract.test.ts
git commit -m "ci: verify source-attested release build"
```

### Task 4: Verify, push, and open a draft PR without merging or deploying

**Files:**
- Verify all files changed in Tasks 1-3
- Do not modify production services

- [ ] **Step 1: Run the complete local quality gate**

```powershell
bun install --frozen-lockfile
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

Expected: every command exits 0.

- [ ] **Step 2: Build and inspect the exact committed SHA**

```powershell
$releaseSha = (git rev-parse HEAD).Trim()
$env:SNOTE_RELEASE_SHA = $releaseSha
try {
  bun run build:release
  bun -e 'const { deployedSha } = await Bun.file("dist/version.json").json(); if (deployedSha !== process.env.SNOTE_RELEASE_SHA) throw new Error("release SHA mismatch");'
} finally {
  Remove-Item Env:SNOTE_RELEASE_SHA -ErrorAction SilentlyContinue
}
```

Expected: strict build exits 0 and `dist/version.json.deployedSha` equals `HEAD`.

- [ ] **Step 3: Review the final scope**

```powershell
git status --short
git diff --stat main...HEAD
git diff --check main...HEAD
git log --oneline main..HEAD
```

Expected: clean worktree; only the design, plan, helper, tests, Vite/package wiring, and one CI step differ from `main`.

- [ ] **Step 4: Push and open a draft PR**

```powershell
git push -u origin chore/release-identity
$prBody = @"
## Summary

- add a strict release-build entry point that requires a clean matching Git SHA
- emit the verified SHA as `deployedSha` while ordinary builds emit `null`
- verify the exact artifact identity in CI

## Verification

- RED-GREEN focused Vitest evidence
- full lint, typecheck, coverage, audit, and build gates
- exact-SHA `build:release` artifact inspection

## Safety boundary

No runtime route change, production mutation, deployment, PR #10 change, or Lovable credit usage.
"@
gh pr create --draft --base main --head chore/release-identity --title "build: attest release artifacts to source SHA" --body $prBody
```

- [ ] **Step 5: Wait for fresh CI and stop**

Use `gh pr checks --watch` for the new PR. Report the exact PR head SHA and each
fresh check result. Do not mark the PR ready, merge it, trigger Lovable, deploy
Cloudflare/Supabase, or modify PR #10.
