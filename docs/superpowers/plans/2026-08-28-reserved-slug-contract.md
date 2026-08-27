# Reserved Slug Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every frontend note-slug boundary reject the router-owned names `note`, `privacy`, and `s` case-insensitively before navigation, persistence, or API calls.

**Architecture:** Add one dependency-free frontend helper and keep the existing Edge helper unchanged. Callers import the frontend helper instead of maintaining local regular expressions; one unit test pins frontend/Edge reserved-name parity.

**Tech Stack:** TypeScript, React 19, React Router 8, Vitest 3, Testing Library, Bun 1.3.14, Deno 2.9.3

---

### Task 1: Add the frontend slug contract

**Files:**
- Create: `src/lib/slug.ts`
- Create: `src/lib/__tests__/slug.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `src/lib/__tests__/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RESERVED_SLUGS as EDGE_RESERVED_SLUGS,
  isUsableSlug as isEdgeUsableSlug,
} from "../../../supabase/functions/_shared/slug";
import { RESERVED_SLUGS, isUsableSlug } from "../slug";

describe("frontend note slug contract", () => {
  it.each(["note", "NOTE", "Privacy", "s", "S"])(
    "rejects router-owned slug %s",
    (slug) => expect(isUsableSlug(slug)).toBe(false),
  );

  it.each(["daily", "a_b", "x-y", "a".repeat(64)])(
    "accepts ordinary slug %s",
    (slug) => expect(isUsableSlug(slug)).toBe(true),
  );

  it.each(["", "has space", "a".repeat(65)])(
    "preserves the existing format rejection for %s",
    (slug) => expect(isUsableSlug(slug)).toBe(false),
  );

  it("matches the Edge reserved-name contract", () => {
    expect(RESERVED_SLUGS).toEqual(EDGE_RESERVED_SLUGS);
    for (const slug of RESERVED_SLUGS) {
      expect(isUsableSlug(slug)).toBe(isEdgeUsableSlug(slug));
      expect(isUsableSlug(slug.toUpperCase())).toBe(
        isEdgeUsableSlug(slug.toUpperCase()),
      );
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
bunx vitest run src/lib/__tests__/slug.test.ts
```

Expected: FAIL because `src/lib/slug.ts` does not exist.

- [ ] **Step 3: Implement the smallest helper**

Create `src/lib/slug.ts`:

```ts
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const RESERVED_SLUGS = ["note", "privacy", "s"] as const;

export function isUsableSlug(value: string): boolean {
  const lowered = value.toLowerCase();
  return SLUG_RE.test(value)
    && !(RESERVED_SLUGS as readonly string[]).includes(lowered);
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
bunx vitest run src/lib/__tests__/slug.test.ts
```

Expected: 1 file passes; all table-driven cases pass.

- [ ] **Step 5: Commit the helper contract**

```powershell
git add src/lib/slug.ts src/lib/__tests__/slug.test.ts
git commit -m "fix(slug): define frontend reserved names"
```

### Task 2: Apply the contract to capability boundaries

**Files:**
- Modify: `src/lib/capability/__tests__/url.test.ts`
- Modify: `src/lib/capability/__tests__/client.test.ts`
- Modify: `src/lib/capability/url.ts`
- Modify: `src/lib/capability/client.ts`

- [ ] **Step 1: Add failing URL and response tests**

Add to `src/lib/capability/__tests__/url.test.ts`:

```ts
  it.each(["note", "Privacy", "S"])(
    "rejects router-owned note locator %s",
    (slug) => {
      expect(parseCapabilityLocation(
        new URL(`https://note.syrin.online/${slug}#owner=${TOKEN}`),
      )).toBeNull();
      expect(() => buildCapabilityUrl("owner", TOKEN, slug))
        .toThrow("invalid slug");
    },
  );
```

Add a dedicated case after the valid session cases in
`src/lib/capability/__tests__/client.test.ts`:

```ts
  it.each(["note", "Privacy", "S"])(
    "rejects a capability session with router-owned slug %s",
    async (slug) => {
      const { api } = apiWithSession(privateSession({ slug }));

      await expect(api.openSession(TOKEN)).rejects.toThrow("invalid note session");
    },
  );
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
bunx vitest run src/lib/capability/__tests__/url.test.ts src/lib/capability/__tests__/client.test.ts
```

Expected: reserved names accepted by the current local regexes cause the new
cases to fail.

- [ ] **Step 3: Replace local regexes with the helper**

In `src/lib/capability/url.ts`, import the helper, delete `NOTE_SLUG_RE`, and use
it in both boundaries:

```ts
import { isUsableSlug } from "@/lib/slug";

// parseCapabilityLocation owner/edit branch
if (segments.length !== 1 || !isUsableSlug(segments[0])) return null;

// buildCapabilityUrl
if (scope !== "view" && (!slug || !isUsableSlug(slug))) {
  throw new Error("invalid slug");
}
```

In `src/lib/capability/client.ts`, import the helper, delete the local
`SLUG_RE`, and change the session check to:

```ts
|| !isUsableSlug(session.slug ?? "")
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: both files pass with no warnings.

- [ ] **Step 5: Commit capability validation**

```powershell
git add src/lib/capability/url.ts src/lib/capability/client.ts src/lib/capability/__tests__/url.test.ts src/lib/capability/__tests__/client.test.ts
git commit -m "fix(capability): reject reserved note locators"
```

### Task 3: Fail closed before legacy duplicate persistence

**Files:**
- Modify: `src/lib/legacy/__tests__/cutover.test.ts`
- Modify: `src/lib/legacy/cutover.ts`

- [ ] **Step 1: Add failing side-effect and recovery boundary tests**

Add to `src/lib/legacy/__tests__/cutover.test.ts`:

```ts
  it.each(["note", "Privacy", "S"])(
    "rejects reserved duplicate target %s before persistence or API calls",
    async (targetSlug) => {
      const doc = new Y.Doc();
      const recoveryStore = memoryRecoveryStore();
      const api = { importLegacyNote: vi.fn() };

      await expect(duplicateLegacyNote({
        api,
        source: {
          slug: "daily",
          content: "legacy",
          ydocState: "",
          isEncrypted: false,
          salt: null,
          check: null,
          iterations: null,
        },
        doc,
        targetSlug,
        recoveryStore,
      })).rejects.toThrow("invalid slug");

      expect(recoveryStore.load).not.toHaveBeenCalled();
      expect(recoveryStore.save).not.toHaveBeenCalled();
      expect(api.importLegacyNote).not.toHaveBeenCalled();
    },
  );
```

Add a second case that proves a persisted recovery cannot reintroduce a
router-owned source slug:

```ts
  it("rejects a persisted recovery with a router-owned source slug", async () => {
    const doc = new Y.Doc();
    const recoveryStore = {
      load: vi.fn(() => ({
        sourceSlug: "privacy",
        sourceFingerprint: "a".repeat(64),
        owner: "o".repeat(43),
        checkpointId: "b".repeat(64),
        payload: "AQ",
        isEncrypted: false,
        salt: null,
        check: null,
        iterations: null,
      })),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const api = { importLegacyNote: vi.fn() };

    await expect(duplicateLegacyNote({
      api,
      source: {
        slug: "privacy",
        content: "legacy",
        ydocState: "",
        isEncrypted: false,
        salt: null,
        check: null,
        iterations: null,
      },
      doc,
      targetSlug: "secure-copy",
      recoveryStore,
    })).rejects.toThrow("secure duplicate recovery invalid");

    expect(recoveryStore.save).not.toHaveBeenCalled();
    expect(api.importLegacyNote).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
bunx vitest run src/lib/legacy/__tests__/cutover.test.ts
```

Expected: the existing regex accepts at least `note` and `Privacy`, then reaches
recovery/API setup; the stored recovery case reports a conflict instead of
rejecting the reserved source as invalid.

- [ ] **Step 3: Use the shared helper in cutover validation**

In `src/lib/legacy/cutover.ts`, import `isUsableSlug`, delete the local
`SLUG_RE`, and update both checks:

```ts
import { isUsableSlug } from "@/lib/slug";

function assertSlug(slug: string) {
  if (!isUsableSlug(slug)) throw new Error("invalid slug");
}

// isRecovery
return isUsableSlug(candidate.sourceSlug ?? "")
```

- [ ] **Step 4: Run the test and verify GREEN**

Run the Step 2 command again.

Expected: all cutover tests pass and all three mocks remain untouched for each
reserved target.

- [ ] **Step 5: Commit the legacy boundary**

```powershell
git add src/lib/legacy/cutover.ts src/lib/legacy/__tests__/cutover.test.ts
git commit -m "fix(legacy): reject reserved secure-copy slugs"
```

### Task 4: Apply the contract to user entry points

**Files:**
- Modify: `src/pages/__tests__/Home.legacy-navigation.test.tsx`
- Create: `src/components/__tests__/CommandPaletteBody.slug.test.tsx`
- Modify: `src/pages/__tests__/LegacyNotePage.test.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/components/CommandPaletteBody.tsx`
- Modify: `src/pages/LegacyNotePage.tsx`

- [ ] **Step 1: Add the failing Home test**

Add to `src/pages/__tests__/Home.legacy-navigation.test.tsx`:

```tsx
  it.each(["note", "Privacy", "S"])(
    "rejects router-owned slug %s before lookup or navigation",
    async (slug) => {
      renderHome();
      fireEvent.change(screen.getByLabelText("home.placeholder"), {
        target: { value: slug },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });

      expect(screen.getByText("home.status.invalid")).toBeInTheDocument();
      expect(harness.from).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "home.btn.open" }));
      expect(screen.getByRole("alert")).toHaveTextContent("home.error.invalid_slug");
      expect(harness.softNavigate).not.toHaveBeenCalled();
    },
  );
```

- [ ] **Step 2: Add the failing command-palette test**

Create `src/components/__tests__/CommandPaletteBody.slug.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import CommandPaletteBody from "../CommandPaletteBody";

vi.mock("@/lib/recent-notes", () => ({
  getRecents: () => [],
  getPinned: () => [],
  togglePin: () => [],
}));
vi.mock("@/i18n/index", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("lucide-react", () => ({
  FileText: () => null,
  Home: () => null,
  Keyboard: () => null,
  Pin: () => null,
  PinOff: () => null,
  Plus: () => null,
  Search: () => null,
  Shuffle: () => null,
  X: () => null,
}));

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPaletteBody open onOpenChange={vi.fn()} onOpenHelp={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("CommandPaletteBody slug validation", () => {
  it.each(["note", "Privacy", "S"])(
    "does not offer router-owned slug %s as a note",
    (slug) => {
      renderPalette();
      fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
        target: { value: slug },
      });

      expect(screen.queryByText(`/${slug}`)).not.toBeInTheDocument();
    },
  );

  it("still offers an ordinary note slug", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("cmdk.placeholder"), {
      target: { value: "daily" },
    });

    expect(screen.getByText("/daily")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Add the failing LegacyNotePage target test**

Add `fireEvent` to the Testing Library import, then add to
`src/pages/__tests__/LegacyNotePage.test.tsx`:

```tsx
  it.each(["note", "Privacy", "S"])(
    "disables secure duplication for router-owned target %s",
    async (targetSlug) => {
      harness.open.mockResolvedValue({
        slug: "daily",
        content: "legacy text",
        ydocState: "",
        isEncrypted: false,
        salt: null,
        check: null,
        iterations: null,
      });
      render(<MemoryRouter><LegacyNotePage slug="daily" /></MemoryRouter>);
      await screen.findByText("legacy.read_only");

      fireEvent.change(screen.getByLabelText("legacy.new_slug"), {
        target: { value: targetSlug },
      });

      expect(screen.getByRole("button", { name: "legacy.duplicate_securely" }))
        .toBeDisabled();
    },
  );
```

- [ ] **Step 4: Run UI tests and verify RED**

Run:

```powershell
bunx vitest run src/pages/__tests__/Home.legacy-navigation.test.tsx src/components/__tests__/CommandPaletteBody.slug.test.tsx src/pages/__tests__/LegacyNotePage.test.tsx
```

Expected: the reserved values are still offered, queried, navigated, or enabled.
If the command-dialog test needs an existing global browser polyfill, use the
repository test setup; do not replace runtime UI components with test-only code.

- [ ] **Step 5: Replace the three UI regexes**

In each production file, import `isUsableSlug`, delete its local `SLUG_RE`, and
replace only validation calls:

```ts
import { isUsableSlug } from "@/lib/slug";
```

`src/pages/Home.tsx`:

```ts
if (!isUsableSlug(trimmed)) {
  // preserve the existing invalid-state/error branches
}
```

`src/components/CommandPaletteBody.tsx`:

```ts
const isValidNew = isUsableSlug(trimmed);
```

`src/pages/LegacyNotePage.tsx`:

```ts
const valid = isUsableSlug(slug);
// ...
disabled={duplicating || !isUsableSlug(targetSlug.trim())}
```

Keep the input's existing `pattern="[A-Za-z0-9_-]{1,64}"` and `maxLength={64}`.

- [ ] **Step 6: Run UI tests and verify GREEN**

Run the Step 4 command again.

Expected: all three test files pass without production API calls.

- [ ] **Step 7: Commit UI validation**

```powershell
git add src/pages/Home.tsx src/components/CommandPaletteBody.tsx src/pages/LegacyNotePage.tsx src/pages/__tests__/Home.legacy-navigation.test.tsx src/components/__tests__/CommandPaletteBody.slug.test.tsx src/pages/__tests__/LegacyNotePage.test.tsx
git commit -m "fix(ui): block router-owned note slugs"
```

### Task 5: Verify, review, and remove the executed checklist

**Files:**
- Delete after execution: `docs/superpowers/plans/2026-08-28-reserved-slug-contract.md`

- [ ] **Step 1: Confirm no duplicate production slug regex remains**

```powershell
rg -n "const (NOTE_)?SLUG_RE|\^\[a-zA-Z|\^\[A-Za-z" src/pages/Home.tsx src/components/CommandPaletteBody.tsx src/lib/capability/url.ts src/lib/capability/client.ts src/lib/legacy/cutover.ts src/pages/LegacyNotePage.tsx
```

Expected: no matches. The HTML `pattern` attribute is intentionally retained.

- [ ] **Step 2: Run the focused regression suite**

```powershell
bunx vitest run src/lib/__tests__/slug.test.ts src/lib/capability/__tests__/url.test.ts src/lib/capability/__tests__/client.test.ts src/lib/legacy/__tests__/cutover.test.ts src/pages/__tests__/Home.legacy-navigation.test.tsx src/components/__tests__/CommandPaletteBody.slug.test.tsx src/pages/__tests__/LegacyNotePage.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 3: Run repository quality gates**

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
git diff --check origin/main...HEAD
```

Expected: every command exits 0; the coverage suite reports no failed files or
tests; the bundle-size gate passes.

- [ ] **Step 4: Request an independent correctness and simplification review**

Review only `origin/main...HEAD`. Reject unrelated refactors, backend changes,
Worker changes, deployment changes, duplicate validation abstractions, and
tests that merely inspect source text instead of behavior.

- [ ] **Step 5: Remove this executed implementation checklist**

Delete only `docs/superpowers/plans/2026-08-28-reserved-slug-contract.md`; keep
the approved design spec.

- [ ] **Step 6: Commit final review cleanup**

```powershell
git add -A docs/superpowers/plans/2026-08-28-reserved-slug-contract.md
git commit -m "docs: remove executed reserved slug plan"
```

- [ ] **Step 7: Re-run the focused suite and inspect final state**

Run the Step 2 command, then:

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: focused suite passes; worktree is clean; commits contain only the
approved design and reserved-slug implementation.
