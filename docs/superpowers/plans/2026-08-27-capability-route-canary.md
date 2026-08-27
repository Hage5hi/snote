# Capability Route Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the ordinary note route for an explicitly enabled, polling-only capability canary while leaving default legacy behavior unchanged and producing a build artifact that attests whether the route flag was enabled.

**Architecture:** `App.tsx` reads one exact-string Vite flag and keeps `NotePage` legacy-only unless it is exactly `"true"`; `SplitView` remains hard-coded legacy-only. `NotePage` continues using its existing legacy and capability providers, but legacy containment follows actual capability access and capability sessions are rejected unless their locator, scope, and transport match. Vite records the effective flag in `version.json`, and existing CI builds prove both the ordinary-disabled and strict-enabled manifests without adding jobs or builds.

**Tech Stack:** React 19, TypeScript, Vite 6, Vitest 3, Bun 1.3.14, GitHub Actions.

---

## Scope and file map

- `src/App.tsx`: exact opt-in flag and ordinary-note route wiring only.
- `src/pages/NotePage.tsx`: one polling guard and one `legacyContainment` condition reused by both Topbars.
- `src/vite-env.d.ts`: Vite environment typing.
- `.env.example`: safe default documentation.
- `vite.config.ts`: load the same Vite environment and emit the effective flag in `version.json`.
- `scripts/__tests__/production-note-access-hotfix.test.ts`: source contract for default-off routing and unchanged legacy entry points.
- `src/pages/__tests__/NotePage.encryption-gate.test.tsx`: behavior tests for legacy containment, polling capability routing, and fail-closed sessions.
- `scripts/__tests__/release-build-contract.test.ts`: source contract for manifest attestation and CI proof.
- `.github/workflows/ci.yml`: assertions around the two builds that already run.

Do not modify `SplitView`, Home, RawView, SharePage, capability provider internals,
Auth, Turnstile, Realtime, Supabase Functions, migrations, or database flags.
Do not run local E2E against the tracked production `.env`.

### Task 1: Make ordinary-note capability routing strictly opt-in

**Files:**
- Modify: `scripts/__tests__/production-note-access-hotfix.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/vite-env.d.ts`
- Modify: `.env.example`

- [ ] **Step 1: Replace the single hotfix contract test with two focused tests**

Keep the existing `source()` helper and replace the current `describe` body with:

```ts
describe("production note access hotfix", () => {
  it("keeps ordinary-note capability routing strictly opt-in", () => {
    const app = source("src/App.tsx");
    const envTypes = source("src/vite-env.d.ts");
    const envExample = source(".env.example");

    expect(app).toContain(
      'const NotePage = lazy(() => import("./pages/NotePage"));',
    );
    expect(app).toMatch(
      /const capabilityRoutesEnabled\s*=\s*import\.meta\.env\.VITE_CAPABILITY_ROUTES_ENABLED === "true";/,
    );
    expect(app).toContain(
      "<NotePage legacyOnly={!capabilityRoutesEnabled} />",
    );
    expect(app).not.toContain("<NotePage legacyOnly />");
    expect(envTypes).toContain(
      "readonly VITE_CAPABILITY_ROUTES_ENABLED?: string;",
    );
    expect(envExample).toMatch(
      /^VITE_CAPABILITY_ROUTES_ENABLED=false$/m,
    );
  });

  it("keeps SplitView, Home, and RawView on the legacy backend", () => {
    const split = source("src/pages/SplitView.tsx");
    const home = source("src/pages/Home.tsx");
    const raw = source("src/pages/RawView.tsx");

    expect(split).toContain(
      'const NotePage = lazy(() => import("./NotePage"));',
    );
    expect(split).toContain("legacyOnly");
    expect(home).toContain(
      'import("@/integrations/supabase/client")',
    );
    expect(home).not.toContain(
      'import { supabase } from "@/integrations/supabase/client";',
    );
    expect(home).not.toContain("createCapabilityApi");
    expect(home).not.toContain("createLegacyNoteApi");
    expect(home).not.toContain("note-snapshot:");
    expect(raw).toContain(
      'import { supabase } from "@/integrations/supabase/client";',
    );
    expect(raw).not.toContain("createLegacyNoteApi");
  });
});
```

- [ ] **Step 2: Run the focused contract and confirm RED**

Run:

```powershell
bunx vitest run scripts/__tests__/production-note-access-hotfix.test.ts --reporter=verbose
```

Expected: `keeps ordinary-note capability routing strictly opt-in` fails because
the flag, env declaration, and conditional prop do not exist; the legacy-entry
test passes.

- [ ] **Step 3: Add the minimal route flag wiring**

In `src/App.tsx`, directly after `const queryClient = new QueryClient();`, add:

```ts
const capabilityRoutesEnabled =
  import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED === "true";
```

Change only the ordinary note return in `SlugDispatcher`:

```tsx
<NotePage legacyOnly={!capabilityRoutesEnabled} />
```

Do not change the `SplitView` branch.

In `src/vite-env.d.ts`, add to `ImportMetaEnv`:

```ts
readonly VITE_CAPABILITY_ROUTES_ENABLED?: string;
```

In `.env.example`, before the PWA reporter section, add:

```dotenv
# Capability note-route canary. Disabled unless explicitly approved.
VITE_CAPABILITY_ROUTES_ENABLED=false
```

- [ ] **Step 4: Run the focused contract and app typecheck; confirm GREEN**

Run:

```powershell
bunx vitest run scripts/__tests__/production-note-access-hotfix.test.ts --reporter=verbose
bunx tsc --noEmit -p tsconfig.app.json
```

Expected: both contract tests pass and TypeScript exits `0`.

- [ ] **Step 5: Commit the opt-in route boundary**

```powershell
git add -- scripts/__tests__/production-note-access-hotfix.test.ts src/App.tsx src/vite-env.d.ts .env.example
git commit -m "feat: gate capability note routes"
```

### Task 2: Preserve legacy containment when route parsing is enabled

**Files:**
- Modify: `src/pages/__tests__/NotePage.encryption-gate.test.tsx`
- Modify: `src/pages/NotePage.tsx`

- [ ] **Step 1: Extend the existing plaintext-note test with containment assertions**

In `still mounts a fresh unpinned plaintext note`, keep the existing assertions
and append:

```ts
expect(harness.capabilityOpenSession).not.toHaveBeenCalled();
await waitFor(() =>
  expect(harness.topbarProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      allowEncryptionTransitions: false,
      currentShareUrl: `${window.location.origin}/secret`,
    }),
  ),
);
```

This test renders `<NotePage />`, which models the route flag being enabled but
receiving a plain legacy URL.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
bunx vitest run src/pages/__tests__/NotePage.encryption-gate.test.tsx -t "still mounts a fresh unpinned plaintext note" --reporter=verbose
```

Expected: the test fails because the current code allows encryption transitions
and leaves `currentShareUrl` undefined when `legacyOnly` is false.

- [ ] **Step 3: Derive and reuse one legacy containment condition**

In `src/pages/NotePage.tsx`, after the `if (!doc || !provider) return null;`
guard, replace the current legacy-only calculations with:

```ts
const getContent = () => doc.getText("content").toString();
const legacyContainment = legacyOnly || !capabilityAccess;
const legacyEncryptionSecret = legacyContainment
  ? readEncryptionSecret(location.hash)
  : "";
const currentShareUrl = legacyContainment && typeof window !== "undefined"
  ? `${window.location.origin}/${slug}${
    legacyEncryptionSecret ? `#${encodeURIComponent(legacyEncryptionSecret)}` : ""
  }`
  : undefined;
```

In both the embedded and standalone `Topbar` props, change only:

```tsx
allowEncryptionTransitions={!legacyContainment}
```

Do not change provider selection or encryption gate order.

- [ ] **Step 4: Run the focused file and app typecheck; confirm GREEN**

Run:

```powershell
bunx vitest run src/pages/__tests__/NotePage.encryption-gate.test.tsx --reporter=verbose
bunx tsc --noEmit -p tsconfig.app.json
```

Expected: every test in the file passes and TypeScript exits `0`.

- [ ] **Step 5: Commit the containment invariant**

```powershell
git add -- src/pages/NotePage.tsx src/pages/__tests__/NotePage.encryption-gate.test.tsx
git commit -m "fix: preserve legacy note containment"
```

### Task 3: Admit only matching polling capability sessions

**Files:**
- Modify: `src/pages/__tests__/NotePage.encryption-gate.test.tsx`
- Modify: `src/pages/NotePage.tsx`

- [ ] **Step 1: Add typed capability session fixtures and provider instrumentation**

Add the type-only imports near the existing test imports:

```ts
import type {
  PollingNoteSession,
  PrivateRealtimeNoteSession,
} from "@/lib/capability/client";
```

Add these fields to the hoisted `harness` object:

```ts
capabilityProviderConstruct: vi.fn(),
capabilityProviderConnect: vi.fn(),
capabilityProviderDestroy: vi.fn(),
```

Add this mock after the existing `@/lib/yjs/provider` mock:

```ts
vi.mock("@/lib/yjs/capability-provider", () => ({
  CapabilityYjsProvider: class {
    awareness = {};

    constructor(access: unknown, session: unknown, doc: unknown) {
      harness.capabilityProviderConstruct(access, session, doc);
    }

    setEncryption() {}
    setExpectedEncrypted() {}
    onAwareness() { return vi.fn(); }
    onSyncEvent() { return vi.fn(); }
    connect() {
      harness.capabilityProviderConnect();
      return Promise.resolve();
    }
    flushBeacon() {}
    destroy() {
      harness.capabilityProviderDestroy();
      return Promise.resolve();
    }
  },
}));
```

Add these fixtures above the main `describe` block:

```ts
const CAPABILITY_TOKEN = "a".repeat(43);
const CAPABILITY_NOTE_ID = "00000000-0000-4000-8000-000000000001";

function pollingSession(
  overrides: Partial<PollingNoteSession> = {},
): PollingNoteSession {
  return {
    noteId: CAPABILITY_NOTE_ID,
    slug: "secret",
    scope: "owner",
    realtimeTopic: `note:${CAPABILITY_NOTE_ID}`,
    generation: 1,
    syncStatus: "active",
    currentSequence: 0,
    payloadLimitBytes: 4_194_304,
    checkpointSequence: 0,
    checkpointVersion: null,
    checkpointPayload: null,
    checkpointEncryptionVersion: null,
    missingUpdates: [],
    encryption: {
      enabled: false,
      version: 0,
      salt: null,
      check: null,
      iterations: 600_000,
    },
    syncTransport: "polling",
    realtimeToken: null,
    realtimeExpiresAt: null,
    ...overrides,
  };
}

function privateRealtimeSession(): PrivateRealtimeNoteSession {
  return {
    ...pollingSession(),
    syncTransport: "private-realtime",
    realtimeToken: "header.payload.signature",
    realtimeExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}
```

In `beforeEach`, clear the three new harness spies:

```ts
harness.capabilityProviderConstruct.mockClear();
harness.capabilityProviderConnect.mockClear();
harness.capabilityProviderDestroy.mockClear();
```

- [ ] **Step 2: Add the matching owner/edit polling regression tests**

Add inside `describe("NotePage encryption gate", ...)`:

```ts
it.each(["owner", "edit"] as const)(
  "uses the polling capability provider for a matching %s capability",
  async (scope) => {
    const session = pollingSession({ scope });
    harness.capabilityOpenSession.mockResolvedValue(session);

    render(
      <MemoryRouter initialEntries={[`/secret#${scope}=${CAPABILITY_TOKEN}`]}>
        <Routes>
          <Route path="/:slug" element={<NotePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(harness.capabilityProviderConstruct).toHaveBeenCalled(),
    );
    expect(harness.capabilityOpenSession).toHaveBeenCalledWith(CAPABILITY_TOKEN);
    expect(harness.metaForSlug).not.toHaveBeenCalled();
    expect(harness.providerConstruct).not.toHaveBeenCalled();
    expect(harness.idbConstruct).not.toHaveBeenCalled();
    expect(harness.capabilityProviderConstruct).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "secret", scope, token: CAPABILITY_TOKEN }),
      session,
      expect.anything(),
    );
    await waitFor(() =>
      expect(harness.topbarProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowEncryptionTransitions: true,
          currentShareUrl: undefined,
          capabilityAccess: expect.objectContaining({
            slug: "secret",
            scope,
            token: CAPABILITY_TOKEN,
          }),
        }),
      ),
    );
  },
);
```

- [ ] **Step 3: Add table-driven fail-closed session tests**

Add immediately after the matching-session test:

```ts
it.each([
  ["slug mismatch", pollingSession({ slug: "other" })],
  ["scope mismatch", pollingSession({ scope: "edit" })],
  ["private Realtime", privateRealtimeSession()],
] as const)("fails closed for a %s capability session", async (_label, session) => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  harness.capabilityOpenSession.mockResolvedValue(session);

  const view = render(
    <MemoryRouter initialEntries={[`/secret#owner=${CAPABILITY_TOKEN}`]}>
      <Routes>
        <Route path="/:slug" element={<NotePage />} />
      </Routes>
    </MemoryRouter>,
  );

  try {
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith("Encryption metadata query failed"),
    );
    expect(harness.capabilityOpenSession).toHaveBeenCalledWith(CAPABILITY_TOKEN);
    expect(harness.metaForSlug).not.toHaveBeenCalled();
    expect(harness.docAcquire).not.toHaveBeenCalled();
    expect(harness.providerConstruct).not.toHaveBeenCalled();
    expect(harness.capabilityProviderConstruct).not.toHaveBeenCalled();
    expect(view.queryByTestId("editor")).not.toBeInTheDocument();
    expect(view.queryByTestId("preview")).not.toBeInTheDocument();
    expect(view.getByText("common.loading")).toBeInTheDocument();
  } finally {
    warning.mockRestore();
  }
});
```

The slug/scope cases characterize the existing fail-closed boundary. The
`private Realtime` row is the RED case: current code constructs the capability
provider instead of rejecting the transport.

- [ ] **Step 4: Run the focused file and confirm RED only on private Realtime**

Run:

```powershell
bunx vitest run src/pages/__tests__/NotePage.encryption-gate.test.tsx --reporter=verbose
```

Expected: matching polling and locator-mismatch cases pass; the private
Realtime case fails because no warning is emitted and a provider is constructed.

- [ ] **Step 5: Reject non-polling sessions before committing them to state**

In the capability branch of the metadata effect in `src/pages/NotePage.tsx`,
replace the current locator-only guard with:

```ts
if (
  session.slug !== slug
  || session.scope !== capabilityAccess.scope
  || session.syncTransport !== "polling"
) {
  throw new Error("capability session unavailable");
}
```

Keep this guard before `setCapabilitySession(session)`. Do not add a legacy
fallback and do not change the catch message.

- [ ] **Step 6: Run focused capability tests and typecheck; confirm GREEN**

Run:

```powershell
bunx vitest run src/pages/__tests__/NotePage.encryption-gate.test.tsx src/lib/capability/__tests__/url.test.ts --reporter=verbose
bunx tsc --noEmit -p tsconfig.app.json
```

Expected: all focused tests pass and TypeScript exits `0`.

- [ ] **Step 7: Commit the polling-only boundary**

```powershell
git add -- src/pages/NotePage.tsx src/pages/__tests__/NotePage.encryption-gate.test.tsx
git commit -m "fix: require polling capability sessions"
```

### Task 4: Attest the effective route flag in every build manifest

**Files:**
- Modify: `scripts/__tests__/release-build-contract.test.ts`
- Modify: `vite.config.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add manifest and CI contract tests**

Append these tests inside `describe("release build contract", ...)`:

```ts
it("attests the exact capability route flag in the version manifest", () => {
  expect(viteConfig).toMatch(/loadEnv\(mode, process\.cwd\(\), "VITE_"\)/);
  expect(viteConfig).toMatch(/VITE_CAPABILITY_ROUTES_ENABLED === "true"/);
  expect(viteConfig).toMatch(
    /function emitVersionJson\(capabilityRoutesEnabled: boolean\)/,
  );
  expect(viteConfig).toMatch(
    /JSON\.stringify\(\{[^}]*\bcapabilityRoutesEnabled\b/s,
  );
  expect(viteConfig).toContain("emitVersionJson(capabilityRoutesEnabled)");
});

it("checks disabled ordinary and enabled strict manifests in CI", () => {
  expect(ciWorkflow).toContain(
    "ordinary version artifact must attest disabled capability routes",
  );
  expect(ciWorkflow).toContain('VITE_CAPABILITY_ROUTES_ENABLED: "true"');
  expect(ciWorkflow).toContain(
    "release version artifact must attest enabled capability routes",
  );
});
```

- [ ] **Step 2: Run the release contract and confirm RED**

Run:

```powershell
bunx vitest run scripts/__tests__/release-build-contract.test.ts --reporter=verbose
```

Expected: the two new tests fail because the manifest field, `loadEnv` wiring,
and CI assertions do not exist; the original three release tests pass.

- [ ] **Step 3: Load the effective Vite env and emit its exact boolean**

In `vite.config.ts`, change the Vite import to:

```ts
import { defineConfig, loadEnv, type Plugin } from "vite";
```

Change the plugin signature and emitted object:

```ts
function emitVersionJson(capabilityRoutesEnabled: boolean): Plugin {
  return {
    name: "emit-version-json",
    apply: "build" as const,
    generateBundle() {
      const deployedSha = revalidateReleaseIdentity(RELEASE_IDENTITY);
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({
          buildId: BUILD_ID,
          builtAt: new Date().toISOString(),
          deployedSha,
          capabilityRoutesEnabled,
        }),
      });
    },
  };
}
```

Convert the implicit-object `defineConfig` callback to a block and derive the
flag once for Vite configuration:

```ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const capabilityRoutesEnabled =
    env.VITE_CAPABILITY_ROUTES_ENABLED === "true";

  return {
```

Inside the existing plugin array, replace `emitVersionJson()` with:

```ts
emitVersionJson(capabilityRoutesEnabled),
```

Close the config with:

```ts
  };
});
```

- [ ] **Step 4: Reuse existing CI builds to prove false and true manifests**

In `.github/workflows/ci.yml`, replace the bare `bun run build:check` step and
the existing strict build step with:

```yaml
      - name: Verify ordinary build manifest
        run: |
          bun run build:check
          bun -e 'const { deployedSha, capabilityRoutesEnabled } = await Bun.file("dist/version.json").json(); if (deployedSha !== null) throw new Error("ordinary version artifact must remain unattested"); if (capabilityRoutesEnabled !== false) throw new Error("ordinary version artifact must attest disabled capability routes");'
      - name: Verify source-attested release build
        env:
          SNOTE_RELEASE_SHA: ${{ github.sha }}
          VITE_CAPABILITY_ROUTES_ENABLED: "true"
        run: |
          bun run build:release
          bun -e 'const { deployedSha, capabilityRoutesEnabled } = await Bun.file("dist/version.json").json(); if (deployedSha !== process.env.SNOTE_RELEASE_SHA) throw new Error("release version artifact must attest checked-out SHA"); if (capabilityRoutesEnabled !== true) throw new Error("release version artifact must attest enabled capability routes");'
```

This adds no job or build; it only checks both artifacts already produced.

- [ ] **Step 5: Run the focused contract and tools typecheck; confirm GREEN**

Run:

```powershell
bunx vitest run scripts/__tests__/release-build-contract.test.ts --reporter=verbose
bunx tsc --noEmit -p tsconfig.node.json
bunx tsc --noEmit -p tsconfig.tools.json
```

Expected: five release contract tests pass and both TypeScript commands exit
`0`.

- [ ] **Step 6: Commit build attestation**

```powershell
git add -- scripts/__tests__/release-build-contract.test.ts vite.config.ts .github/workflows/ci.yml
git commit -m "ci: attest capability route builds"
```

### Task 5: Run complete local verification on the committed branch

**Files:**
- Verify only; no source edits expected.

- [ ] **Step 1: Prove the dependency and static-analysis gates**

Run:

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
```

Expected: every command exits `0`; audit reports no high vulnerability.

- [ ] **Step 2: Run the full offline test suite**

```powershell
bun run test:coverage
```

Expected: every Vitest file and test passes. This suite is offline and may use
the repository's in-process PGlite database; it must not contact production.

- [ ] **Step 3: Prove the ordinary artifact is legacy-disabled and unattested**

Run:

```powershell
Remove-Item Env:VITE_CAPABILITY_ROUTES_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:SNOTE_RELEASE_SHA -ErrorAction SilentlyContinue
bun run build:check
$ordinary = Get-Content -LiteralPath "dist/version.json" -Raw | ConvertFrom-Json
if ($null -ne $ordinary.deployedSha) { throw "ordinary deployedSha must be null" }
if ($ordinary.capabilityRoutesEnabled -ne $false) { throw "ordinary capability routes must be false" }
```

Expected: build and bundle-size gate pass; both assertions remain silent.

- [ ] **Step 4: Prove the strict artifact attests both the clean HEAD and enabled flag**

The strict helper rejects dirty worktrees, so run this only after Tasks 1–4 and
the plan document are committed.

```powershell
$releaseSha = (git rev-parse HEAD).Trim()
$env:SNOTE_RELEASE_SHA = $releaseSha
$env:VITE_CAPABILITY_ROUTES_ENABLED = "true"
try {
  bun run build:release
  $release = Get-Content -LiteralPath "dist/version.json" -Raw | ConvertFrom-Json
  if ($release.deployedSha -ne $releaseSha) { throw "strict deployedSha mismatch" }
  if ($release.capabilityRoutesEnabled -ne $true) { throw "strict capability routes must be true" }
} finally {
  Remove-Item Env:SNOTE_RELEASE_SHA -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_CAPABILITY_ROUTES_ENABLED -ErrorAction SilentlyContinue
}
```

Expected: strict build passes and both assertions remain silent.

- [ ] **Step 5: Confirm the branch is clean and review only the stacked delta**

```powershell
git status --short
git log --oneline --decorate chore/release-identity..HEAD
git diff --check chore/release-identity...HEAD
git diff --stat chore/release-identity...HEAD
```

Expected: status is empty; diff check emits nothing; the log contains the design,
plan, and four small implementation commits only.

Do not run local Playwright against the tracked `.env`; the PR's Chromium smoke
uses safe invalid CI endpoints.

### Task 6: Push a stacked draft PR and stop before merge or deploy

**Files:**
- GitHub metadata only; no source edits expected.

- [ ] **Step 1: Push the feature branch without changing either base branch**

```powershell
git push -u origin feat/capability-route-canary
```

Expected: `chore/release-identity` and `main` remain unchanged.

- [ ] **Step 2: Create the stacked PR as draft**

```powershell
gh pr create --draft --base chore/release-identity --head feat/capability-route-canary --title "feat: prepare polling capability route canary" --body "Prepares the ordinary note route for an exact opt-in polling capability canary. Default builds remain legacy-only. Adds legacy containment, fail-closed locator/scope/transport checks, and version-manifest attestation. No merge, production activation, backend mutation, Realtime, or Lovable usage is included."
```

Expected: GitHub creates a draft PR whose base is `chore/release-identity`.

- [ ] **Step 3: Wait for fresh checks on the exact PR head**

```powershell
$head = (git rev-parse HEAD).Trim()
gh pr checks feat/capability-route-canary --watch
$remoteHead = (gh pr view feat/capability-route-canary --json headRefOid --jq .headRefOid).Trim()
if ($remoteHead -ne $head) { throw "PR head changed during verification" }
```

Expected: `quality`, `e2e-pr`, and `extension-e2e` pass on the exact local HEAD.

- [ ] **Step 4: Stop at the review boundary**

Confirm the PR is still draft and report the URL, exact SHA, local gate evidence,
and CI results. Do not mark ready, merge, deploy, change Supabase flags, run the
atomic cutover migration, publish through Lovable, or spend Lovable credits.
