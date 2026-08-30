# Post-deploy Release Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-deploy smoke workflow fail closed unless the live manifest proves the exact expected commit and capability-routing state.

**Architecture:** Add one dependency-free TypeScript verifier with an injected-fetch boundary, then call it before every existing post-deploy smoke step. Keep live identity verification separate from the existing mocked PWA behavior tests; do not add a deployment abstraction or change any provider.

**Tech Stack:** Bun 1.3.14, TypeScript, native Fetch/Response APIs, Vitest 3.2.6, GitHub Actions.

---

## File map

- Create `scripts/verify-live-release.ts`: validate inputs, fetch the live manifest, and enforce exact release identity.
- Create `scripts/__tests__/verify-live-release.test.ts`: offline verifier cases plus a small workflow-wiring contract.
- Modify `.github/workflows/pwa-update-smoke-post-deploy.yml`: require explicit manual expectations and run attestation before smoke work.
- Keep all PWA specs, deployment providers, application code, Worker code, Supabase code, and rollout state unchanged.

### Task 1: Build the dependency-free live-manifest verifier

**Files:**
- Create: `scripts/verify-live-release.ts`
- Create: `scripts/__tests__/verify-live-release.test.ts`

- [ ] **Step 1: Write the failing verifier tests**

Create `scripts/__tests__/verify-live-release.test.ts` with the following verifier contract. Do not add the workflow-wiring test until Task 2.

```ts
/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  verifyLiveRelease,
  type FetchLike,
  type LiveReleaseInput,
} from "../verify-live-release";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const validInput: LiveReleaseInput = {
  baseUrl: "https://note.syrin.online",
  expectedSha: SHA,
  expectedCapabilityRoutesEnabled: "false",
};

function manifestResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "private, no-store");
  }
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status: 200, ...init, headers },
  );
}

function recordingFetch(response: Response): {
  fetchImpl: FetchLike;
  calls: Array<{ url: URL; init: RequestInit }>;
} {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
  };
}

async function rejectionMessage(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("Expected operation to reject");
}

describe("live release attestation", () => {
  it("accepts the exact SHA and disabled capability state", async () => {
    const { fetchImpl, calls } = recordingFetch(manifestResponse({
      buildId: "build-1",
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    }));

    await expect(verifyLiveRelease(validInput, fetchImpl)).resolves.toEqual({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe("https://note.syrin.online/version.json");
    expect(calls[0]?.init).toMatchObject({
      cache: "no-store",
      redirect: "error",
    });
  });

  it("accepts an explicitly enabled capability state", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse({
      deployedSha: SHA,
      capabilityRoutesEnabled: true,
    }));

    await expect(verifyLiveRelease({
      ...validInput,
      expectedCapabilityRoutesEnabled: "true",
    }, fetchImpl)).resolves.toEqual({
      deployedSha: SHA,
      capabilityRoutesEnabled: true,
    });
  });

  it.each([
    [{ expectedSha: "" }, /40-character lowercase/],
    [{ expectedSha: SHA.toUpperCase() }, /40-character lowercase/],
    [{ expectedSha: "abc" }, /40-character lowercase/],
    [{ expectedCapabilityRoutesEnabled: "0" }, /exactly true or false/],
    [{ expectedCapabilityRoutesEnabled: "False" }, /exactly true or false/],
    [{ baseUrl: "ftp://note.syrin.online" }, /absolute HTTP or HTTPS/],
  ])("rejects invalid expected input before fetch: %o", async (override, message) => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      throw new Error("must not fetch");
    };

    await expect(
      verifyLiveRelease({ ...validInput, ...override }, fetchImpl),
    ).rejects.toThrow(message);
    expect(calls).toBe(0);
  });

  it("rejects network failures with a generic error", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("provider URL with private details");
    };
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      "Unable to fetch live release manifest.",
    );
  });

  it("requires HTTP 200 without echoing the response body", async () => {
    const secret = "body-must-not-be-logged";
    const { fetchImpl } = recordingFetch(new Response(secret, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }));
    const message = await rejectionMessage(
      verifyLiveRelease(validInput, fetchImpl),
    );
    expect(message).toBe("Live release manifest returned HTTP 503.");
    expect(message).not.toContain(secret);
  });

  it("requires the no-store cache directive", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse({
      deployedSha: SHA,
      capabilityRoutesEnabled: false,
    }, { headers: { "Cache-Control": "no-cache" } }));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      /must use Cache-Control: no-store/,
    );
  });

  it.each([null, [], "text", 42])(
    "rejects a non-object manifest: %o",
    async (body) => {
      const { fetchImpl } = recordingFetch(manifestResponse(body));
      await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
        "Live release manifest must be a JSON object.",
      );
    },
  );

  it("rejects malformed JSON", async () => {
    const { fetchImpl } = recordingFetch(manifestResponse("{"));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(
      "Live release manifest is not valid JSON.",
    );
  });

  it.each([
    [{ capabilityRoutesEnabled: false }, /SHA does not match/],
    [{ deployedSha: null, capabilityRoutesEnabled: false }, /SHA does not match/],
    [{ deployedSha: OTHER_SHA, capabilityRoutesEnabled: false }, /SHA does not match/],
    [{ deployedSha: SHA }, /capability route state does not match/],
    [{ deployedSha: SHA, capabilityRoutesEnabled: null }, /capability route state does not match/],
    [{ deployedSha: SHA, capabilityRoutesEnabled: "false" }, /capability route state does not match/],
    [{ deployedSha: SHA, capabilityRoutesEnabled: true }, /capability route state does not match/],
  ])("rejects stale or malformed fields: %o", async (body, message) => {
    const { fetchImpl } = recordingFetch(manifestResponse(body));
    await expect(verifyLiveRelease(validInput, fetchImpl)).rejects.toThrow(message);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

```powershell
bunx vitest run scripts/__tests__/verify-live-release.test.ts
```

Expected: FAIL during module loading because `scripts/verify-live-release.ts` does not exist. Do not weaken assertions to obtain a different failure.

- [ ] **Step 3: Implement the minimal verifier**

Create `scripts/verify-live-release.ts`:

```ts
export type LiveReleaseInput = {
  baseUrl: string | undefined;
  expectedSha: string | undefined;
  expectedCapabilityRoutesEnabled: string | undefined;
};

export type LiveReleaseIdentity = {
  deployedSha: string;
  capabilityRoutesEnabled: boolean;
};

export type FetchLike = (
  url: URL,
  init: RequestInit,
) => Promise<Response>;

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function expectedCapability(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    "EXPECTED_CAPABILITY_ROUTES_ENABLED must be exactly true or false.",
  );
}

function manifestUrl(baseUrl: string | undefined): URL {
  try {
    const url = new URL(baseUrl ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    if (url.username || url.password) throw new Error();
    return new URL("/version.json", url);
  } catch {
    throw new Error("SMOKE_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }
}

function hasNoStore(value: string | null): boolean {
  return value?.split(",").some(
    (directive) => directive.trim().toLowerCase() === "no-store",
  ) ?? false;
}

export async function verifyLiveRelease(
  input: LiveReleaseInput,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<LiveReleaseIdentity> {
  if (!input.expectedSha || !COMMIT_SHA.test(input.expectedSha)) {
    throw new Error(
      "EXPECTED_DEPLOYED_SHA must be an exact 40-character lowercase commit SHA.",
    );
  }
  const capabilityRoutesEnabled = expectedCapability(
    input.expectedCapabilityRoutesEnabled,
  );
  const url = manifestUrl(input.baseUrl);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Unable to fetch live release manifest.");
  }

  if (response.status !== 200) {
    throw new Error(`Live release manifest returned HTTP ${response.status}.`);
  }
  if (!hasNoStore(response.headers.get("Cache-Control"))) {
    throw new Error("Live release manifest must use Cache-Control: no-store.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Live release manifest is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Live release manifest must be a JSON object.");
  }

  const manifest = body as Record<string, unknown>;
  if (manifest.deployedSha !== input.expectedSha) {
    throw new Error("Live release SHA does not match the expected deployment.");
  }
  if (manifest.capabilityRoutesEnabled !== capabilityRoutesEnabled) {
    throw new Error(
      "Live capability route state does not match the expected deployment.",
    );
  }

  return {
    deployedSha: input.expectedSha,
    capabilityRoutesEnabled,
  };
}

if (import.meta.main) {
  try {
    const identity = await verifyLiveRelease({
      baseUrl: process.env.SMOKE_BASE_URL,
      expectedSha: process.env.EXPECTED_DEPLOYED_SHA,
      expectedCapabilityRoutesEnabled:
        process.env.EXPECTED_CAPABILITY_ROUTES_ENABLED,
    });
    console.log(
      `Verified live release ${identity.deployedSha} `
      + `capabilityRoutesEnabled=${identity.capabilityRoutesEnabled}`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Live release attestation failed.",
    );
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Run focused GREEN checks**

```powershell
bunx vitest run scripts/__tests__/verify-live-release.test.ts
bunx eslint --no-ignore scripts/verify-live-release.ts scripts/__tests__/verify-live-release.test.ts
bunx tsc --noEmit -p tsconfig.tools.json
```

Expected: all verifier tests PASS; ESLint and tools TypeScript exit `0`.

- [ ] **Step 5: Commit the verifier**

```powershell
git add -- scripts/verify-live-release.ts scripts/__tests__/verify-live-release.test.ts
git diff --cached --check
git commit -m "feat(release): verify live deployment manifest"
```

Expected: one focused commit containing only the verifier and its offline tests.

### Task 2: Wire attestation before every post-deploy smoke step

**Files:**
- Modify: `scripts/__tests__/verify-live-release.test.ts`
- Modify: `.github/workflows/pwa-update-smoke-post-deploy.yml`

- [ ] **Step 1: Add a failing workflow contract**

Add this import and test block to `scripts/__tests__/verify-live-release.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("post-deploy workflow wiring", () => {
  it("requires explicit expectations and attests before smoke work", () => {
    const workflow = readFileSync(resolve(
      process.cwd(),
      ".github/workflows/pwa-update-smoke-post-deploy.yml",
    ), "utf8").replace(/\r\n/g, "\n");

    expect(workflow).toMatch(
      /expected_sha:\n[\s\S]*?required:\s*true[\s\S]*?type:\s*string/,
    );
    expect(workflow).toMatch(
      /expected_capability_routes_enabled:\n[\s\S]*?required:\s*true[\s\S]*?type:\s*choice[\s\S]*?default:\s*['"]false['"][\s\S]*?options:\s*\n\s+- ['"]?false['"]?\n\s+- ['"]?true['"]?/,
    );
    expect(workflow).toContain("github.event.deployment.sha");
    expect(workflow).toContain("EXPECTED_DEPLOYED_SHA");
    expect(workflow).toContain("EXPECTED_CAPABILITY_ROUTES_ENABLED");

    const attestAt = workflow.indexOf("name: Verify live release identity");
    const installAt = workflow.indexOf("run: bun install --frozen-lockfile");
    const frameAt = workflow.indexOf("scripts/verify-frame-ancestors.sh");
    const playwrightAt = workflow.indexOf("name: Run post-deploy smoke");

    expect(attestAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(attestAt);
    expect(frameAt).toBeGreaterThan(attestAt);
    expect(playwrightAt).toBeGreaterThan(attestAt);
    expect(workflow).toMatch(
      /name: Verify live release identity\s+run: bun run scripts\/verify-live-release\.ts/,
    );
  });
});
```

- [ ] **Step 2: Run the contract to verify RED**

```powershell
bunx vitest run scripts/__tests__/verify-live-release.test.ts
```

Expected: verifier cases remain green and the workflow test FAILS because the inputs, environment values, and attestation step are absent.

- [ ] **Step 3: Add explicit manual inputs and job expectations**

Extend `workflow_dispatch.inputs`:

```yaml
      expected_sha:
        description: Exact deployed commit SHA expected in /version.json
        required: true
        type: string
      expected_capability_routes_enabled:
        description: Expected capability route state in /version.json
        required: true
        type: choice
        default: "false"
        options:
          - "false"
          - "true"
```

Extend the `smoke` job environment, preserving the existing `SMOKE_BASE_URL` expression:

```yaml
      EXPECTED_DEPLOYED_SHA: >-
        ${{
          github.event_name == 'deployment_status' &&
          github.event.deployment.sha ||
          inputs.expected_sha
        }}
      EXPECTED_CAPABILITY_ROUTES_ENABLED: >-
        ${{
          github.event_name == 'deployment_status' &&
          'false' ||
          inputs.expected_capability_routes_enabled
        }}
```

Immediately after `oven-sh/setup-bun@v2`, before `bun install`, add:

```yaml
      - name: Verify live release identity
        run: bun run scripts/verify-live-release.ts
```

- [ ] **Step 4: Run workflow-focused GREEN checks**

```powershell
bunx vitest run scripts/__tests__/verify-live-release.test.ts
bunx eslint --no-ignore scripts/verify-live-release.ts scripts/__tests__/verify-live-release.test.ts
bunx tsc --noEmit -p tsconfig.tools.json
```

Expected: all verifier and workflow-contract tests PASS; ESLint and tools TypeScript exit `0`. Do not invoke the live CLI because the current production manifest is intentionally old and this task performs no deployment.

- [ ] **Step 5: Commit workflow wiring**

```powershell
git add -- .github/workflows/pwa-update-smoke-post-deploy.yml scripts/__tests__/verify-live-release.test.ts
git diff --cached --check
git commit -m "ci(release): attest deployment before PWA smoke"
```

Expected: one commit limited to the workflow and its contract test.

### Task 3: Run release-quality verification and independent reviews

**Files:**
- Verify only. Modify a file only when a gate proves a defect in this concern; use a new RED-GREEN cycle and separate fix commit.

- [ ] **Step 1: Run static, dependency, and workflow-source gates**

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

Expected: every command exits `0`; dependency audit reports no high-severity finding.

- [ ] **Step 2: Run full coverage and ordinary build**

```powershell
bun run test:coverage
bun run build:check
```

Expected: all test files pass, including the new verifier/workflow contract; coverage completes and the bundle gate passes.

- [ ] **Step 3: Verify an exact-SHA, capability-disabled release artifact**

```powershell
$env:SNOTE_RELEASE_SHA = (git rev-parse HEAD)
$env:VITE_CAPABILITY_ROUTES_ENABLED = "false"
try {
  bun run build:release
  bun -e 'const v = await Bun.file("dist/version.json").json(); if (v.deployedSha !== process.env.SNOTE_RELEASE_SHA || v.capabilityRoutesEnabled !== false) process.exit(1);'
} finally {
  Remove-Item Env:SNOTE_RELEASE_SHA,Env:VITE_CAPABILITY_ROUTES_ENABLED -ErrorAction SilentlyContinue
}
```

Expected: release build succeeds, manifest attests exact HEAD with capability routes disabled, and temporary environment variables are removed. Do not upload this artifact.

- [ ] **Step 4: Verify exact scope and absence of sensitive material**

```powershell
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
git diff --no-ext-diff origin/main...HEAD | rg -n -i 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY\s*=|CLOUDFLARE_API_TOKEN\s*=|ADMIN_PASSPHRASE\s*=|CAPABILITY_HMAC_SECRET\s*=|eyJ[A-Za-z0-9_-]{20,}'
git status --short
```

Expected: changed paths are limited to the approved spec, plan, verifier, verifier test, and workflow; secret scan has no match; generated `dist` remains ignored; worktree is clean.

- [ ] **Step 5: Request two independent reviews**

Dispatch:

1. a correctness/security reviewer to verify fail-closed inputs, request behavior, manifest checks, workflow event expressions, step order, and no-body error handling;
2. an over-engineering reviewer to identify only removable complexity introduced by this PR.

Resolve P0-P2 findings with TDD and re-review. Apply a P3 simplification only when it removes real code without weakening the exact attestation contract.

### Task 4: Publish a focused PR and stop before deployment

**Files:**
- Git/GitHub metadata only.

- [ ] **Step 1: Push the feature branch**

```powershell
git push -u origin fix/post-deploy-release-attestation
```

Expected: ordinary push succeeds; `main` and all cloud providers remain unchanged.

- [ ] **Step 2: Open a non-draft PR against `main`**

Use title `ci(release): attest live deployment before PWA smoke` and this body:

```markdown
## Summary

- verify the live release manifest before post-deploy PWA smoke work
- require exact deployment SHA and explicit capability-route state
- fail closed on stale, malformed, redirected, or cacheable manifests

## Boundary

Source and workflow verification only. This PR does not deploy a frontend,
change a provider, activate capability routes, mutate Supabase/Cloudflare/
Lovable, purge caches, or apply an atomic cutover.

## Verification

- offline verifier and workflow-contract tests
- audit, lint, Knip, i18n, TypeScript, and Edge checks
- full coverage and bundle gate
- strict exact-SHA build with capability routes disabled
- independent correctness/security and over-engineering review
```

- [ ] **Step 3: Wait for exact-head required checks**

Wait for `quality`, `e2e-pr`, and `extension-e2e`. If a check fails, inspect the cause and fix code in a new commit; do not rerun blindly.

- [ ] **Step 4: Stop at the merge checkpoint**

Report PR URL, exact head SHA, local evidence, independent-review results, and required-check conclusions. Do not merge or deploy until the owner explicitly approves the next step.
