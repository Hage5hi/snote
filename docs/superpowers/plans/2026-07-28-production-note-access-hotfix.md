# Production Note Access Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore production opening and creation of legacy notes without changing backend state.

**Architecture:** Ordinary note routes temporarily select the existing legacy Supabase client/provider that matches the deployed backend. Capability backend source remains dormant until its functions and migrations are staged and deployed in order.

**Tech Stack:** React 19, React Router 8, Supabase JS, Vitest, Bun, Vite

---

### Task 1: Pin the production runtime contract

**Files:**
- Create: `scripts/__tests__/production-note-access-hotfix.test.ts`

- [x] **Step 1: Write the failing contract test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("production note access hotfix", () => {
  it("keeps ordinary note entry points on the deployed legacy backend", () => {
    const app = source("src/App.tsx");
    const split = source("src/pages/SplitView.tsx");
    const home = source("src/pages/Home.tsx");
    const raw = source("src/pages/RawView.tsx");

    expect(app).toContain('const NotePage = lazy(() => import("./pages/NotePage"));');
    expect(app).toContain("<NotePage legacyOnly />");
    expect(split).toContain('const NotePage = lazy(() => import("./NotePage"));');
    expect(split).toContain("legacyOnly");
    expect(home).toContain('import("@/integrations/supabase/client")');
    expect(home).not.toContain('import { supabase } from "@/integrations/supabase/client";');
    expect(home).not.toContain("createCapabilityApi");
    expect(home).not.toContain("createLegacyNoteApi");
    expect(home).not.toContain("note-snapshot:");
    expect(raw).toContain('import { supabase } from "@/integrations/supabase/client";');
    expect(raw).not.toContain("createLegacyNoteApi");
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `bunx vitest run scripts/__tests__/production-note-access-hotfix.test.ts`

Expected: FAIL because App/Split select `CutoverNotePage` and Home/RawView call missing Edge Functions.

### Task 2: Restore the deployed client contract

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/SplitView.tsx`
- Modify: `src/pages/NotePage.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/RawView.tsx`
- Modify: `src/lib/yjs/provider.ts`
- Modify: `src/components/note/Editor.tsx`
- Modify: `src/components/note/ShareDialog.tsx`
- Modify: `src/components/note/SyncIndicator.tsx`
- Modify: `src/components/note/topbar/Topbar.tsx`
- Delete: `src/lib/capability/create-recovery.ts`
- Delete: `src/lib/capability/__tests__/create-recovery.test.ts`
- Modify: `src/lib/yjs/__tests__/provider.test.ts`
- Modify: `src/components/note/__tests__/Editor.write-fence.test.tsx`
- Create: `src/components/note/__tests__/ShareDialog.legacy-url.test.tsx`
- Create: `src/components/note/__tests__/SyncIndicator.a11y.test.tsx`
- Create: `src/components/note/__tests__/Topbar.encryption-transitions.test.tsx`
- Modify: `e2e/critical-a11y.spec.ts`
- Modify: `src/pages/__tests__/SplitView.behavior.test.tsx`
- Modify: `src/pages/__tests__/NotePage.encryption-gate.test.tsx`
- Create: `src/pages/__tests__/Home.legacy-navigation.test.tsx`
- Create: `src/pages/__tests__/RawView.behavior.test.tsx`
- Test: `scripts/__tests__/production-note-access-hotfix.test.ts`

- [x] **Step 1: Select the existing default note component**

Use direct lazy imports in both route entry points and pass `legacyOnly` when
rendering the default component:

```ts
const NotePage = lazy(() => import("./pages/NotePage"));
```

```ts
const NotePage = lazy(() => import("./NotePage"));
```

- [x] **Step 2: Restore Home's exact legacy lookup and navigation**

Load the existing client lazily so Home does not add Supabase to the initial
module preload set:

```ts
const loadSupabase = async () => (await import("@/integrations/supabase/client")).supabase;
```

The debounced query must use `.from("notes").select("slug, char_count").eq("slug", trimmed).maybeSingle()` with the current abort signal. Submit must call `softNavigate(navigate, `/${trimmed}`)`, and Random note must navigate directly to `/${randomSlug()}`. Remove capability creation recovery and `legacy-note-open` imports from Home.

- [x] **Step 3: Restore RawView's exact direct read**

Replace `createLegacyNoteApi().open(slug)` with an exact Supabase query selecting `content, ydoc_state, is_encrypted, enc_salt, enc_check, enc_iterations`. Preserve the existing fragment-only encryption secret flow and map the database column names directly.

- [x] **Step 4: Make teardown and route changes loss-safe**

Flush a pending legacy snapshot before provider teardown for both plaintext and
encrypted notes, except when the slug was explicitly abandoned. Serialize
snapshot writes per slug across provider remounts, observe local document edits
from provider construction, and only clear the pending marker for the local
version that was actually persisted. In RawView, key state to the complete route
target, reject results after each asynchronous phase and live-URL transition
when their route is stale, and preserve `window.history.state` during query-key
migration. Keep direct Home navigation enabled when its optional availability
lookup fails. Hide legacy lock/unlock transitions until a backend conditional
write primitive can make encryption-mode changes atomic. Pass a sanitized
key-only share URL so dormant owner/edit fragments never reach QR or clipboard.
Name the CodeMirror textbox and use a contrast-safe synced label. Remove the
Home-only create-recovery helper after it becomes unreachable, so the unused
code gate remains meaningful.

- [x] **Step 5: Run the contract test and verify GREEN**

Run: `bunx vitest run scripts/__tests__/production-note-access-hotfix.test.ts`

Expected: 1 test passed.

- [x] **Step 6: Run focused behavior tests**

Run: `bunx vitest run src/lib/yjs/__tests__/provider.test.ts src/pages/__tests__/RawView.behavior.test.tsx src/pages/__tests__/Home.legacy-navigation.test.tsx src/pages/__tests__/Home.a11y.test.tsx src/pages/__tests__/NotePage.encryption-gate.test.tsx src/pages/__tests__/SplitView.behavior.test.tsx scripts/__tests__/production-note-access-hotfix.test.ts`

Expected: all selected files pass with zero failures.

### Task 3: Verify, review, and publish the emergency repair

**Files:**
- Modify if required by tests: only the six runtime files and directly coupled tests

- [x] **Step 1: Run repository gates**

Run:

```powershell
bun run lint
bun audit --audit-level=high
bun run knip
bun run i18n:check
bun run i18n:allowlist
bunx tsc --noEmit -p tsconfig.app.json
bunx tsc --noEmit -p tsconfig.node.json
bunx tsc --noEmit -p tsconfig.tools.json
bun run typecheck:edge
bun run test
bun run test:coverage
bun run build:check
$env:VITE_SUPABASE_URL='https://ci.invalid'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='ci-public-placeholder'
bunx playwright test e2e/critical-a11y.spec.ts e2e/pwa-update-sw-stall.spec.ts --project=chromium --retries=0
```

Expected: every command exits zero.

- [x] **Step 2: Request independent review**

Review the diff from `origin/main` for data-loss risk, unexpected capability activation, and regressions in ordinary, split, encrypted, and raw note paths. Resolve every Critical or Important finding before publication.

- [ ] **Step 3: Commit and publish the hotfix**

Stage only the design, plan, contract and behavior tests, the route/runtime
repairs, the legacy provider durability fix, accessibility corrections, share
URL containment, and the two now-unused Home recovery deletions. Commit as
`hotfix: restore production note access`, push
`agent/hotfix-restore-legacy-notes`, and open an emergency PR to `main`
describing the missing-function root cause and zero-migration rollback.

- [ ] **Step 4: Merge only after GitHub checks are green**

Confirm the PR head SHA, `quality`, and `e2e-pr`. Merge with squash only when all required checks succeed.

- [ ] **Step 5: Verify the Lovable deployment**

Poll `https://note.syrin.online/version.json` until its build ID differs from `1785211588681-xlsiz8dl`. Perform a synthetic-slug navigation check and inspect its network activity to verify the ordinary route does not call `legacy-note-open` or `note-session`. Do not read or log user data.
