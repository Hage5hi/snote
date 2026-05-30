## 1. Language persistence (verify + harden)

The current code in `src/i18n/provider.tsx` already writes the choice to `localStorage["lang"]` in `setLang` and reads it back via `detectLang()` on mount, so reload restores it. Two small hardening tweaks:

- In `provider.tsx`, when the IP-geo fetch resolves, only apply the guessed language if `localStorage["lang"]` is still empty (race-safety if the user clicks a language during the 2.5s window).
- Add a once-only fallback in `detectLang()`: if `localStorage` throws (private mode), fall back to `sessionStorage` so the choice at least survives within the tab.

No schema/dictionary changes — language list stays at 9.

## 2. LanguageToggle contrast & polish

Update `src/components/LanguageToggle.tsx`:

- Trigger button: bump text from `text-xs` → `text-[13px] font-semibold`, increase gap to `gap-2`, add `text-foreground` so the language code is high-contrast on both light/dark and on scene-tinted headers.
- Flag: nudge size 18→20 in trigger, add a thin `ring-1 ring-foreground/15` (already in `Flag.tsx` — bump from `ring-border/40` → `ring-foreground/20` for visibility on busy scene backgrounds).
- Dropdown row: keep flag 20px, body text `text-sm font-medium`, check icon `text-primary`.
- Tooltip already covers the "Choose language" affordance — keep it.

## 3. Hide SceneToggle on mobile

In `src/pages/Home.tsx` header (the only place SceneToggle is rendered for app-wide use besides `Topbar`):

- Import `useIsMobile` from `@/hooks/use-mobile`.
- Conditionally render `<SceneToggle />` only when `!isMobile`.
- Also: when `isMobile` is true, force-clear any persisted scene once on mount (`setScene(SCENE_NONE)` if `committedScene !== "none"`) so mobile users don't carry a heavyweight WebGL scene from a desktop session.
- Apply the same `!isMobile` guard in `src/components/note/topbar/Topbar.tsx` for the two `<SceneToggle />` usages (wide + narrow rows). On the narrow row it's already hidden behind `compact`; add the mobile guard regardless.

Scene rendering itself is already guarded by `committedScene !== "none"`, so once the toggle is hidden + cleared, `SceneHost` returns null and zero WebGL cost on mobile.

## 4. Memory growth on F5 — root cause + fix

The biggest contributor to heap growth on each Home reload is `src/pages/Home.tsx` lines 122–132:

```ts
onIdle(() => {
  void import("@/pages/NotePage");
  void import("yjs");
  void import("y-indexeddb");
  void import("y-codemirror.next");
  void import("@codemirror/lang-markdown");
  void import("marked");
  void import("dompurify");
});
```

These eagerly pull ~hundreds of KB of editor code into the JS heap on **every** Home visit — even if the user never opens a note. After F5, the same chunks are re-parsed and retained. On mobile + low-end devices this is the dominant cost.

Changes:

- **Gate the warm-up.** Only prefetch when *all* are true:
  - not mobile (`!useIsMobile()`),
  - `navigator.connection?.saveData !== true`,
  - `navigator.connection?.effectiveType` not in `{"2g","slow-2g","3g"}`,
  - `navigator.deviceMemory ?? 8 >= 4`.
- **Trigger lazily, not on idle.** Replace `onIdle` with: prefetch on the first of (a) user types into the slug input, (b) user hovers/touches a recent/pinned item, (c) 8s after first paint if still idle. This delays cost until intent is signaled.
- Move the prefetch list into a single `prefetchEditor()` helper that is idempotent (guard with a module-level `let warmed = false`).

Secondary cleanups:

- `src/components/home/SceneHost.tsx`: the cached `webglAvailable` probe creates a throwaway canvas every page load. Keep the probe but also `c.width = c.height = 1` before `getContext` to make Chrome reserve minimal GPU memory, and null out `c` after `loseContext` so GC can reclaim sooner.
- `src/components/Flag.tsx`: 9 dropdown flags hit `flagcdn.com` on every open. Add `fetchpriority="low"` and only render the dropdown flags when the menu is open (gate the `SUPPORTED_LANGS.map(...)` behind the existing `DropdownMenuContent`, which is already portal-mounted on open — confirm by removing any preloading). Net: only the current-language flag in the trigger is fetched at idle.
- `src/pages/Home.tsx`: the `useEffect` that subscribes to `storage` for pin sync is fine; no change.
- No changes to scene shaders, scene tokens, or visual theming — visuals stay byte-identical.

## 5. Verification

- Manual: reload Home 5× with DevTools Memory panel; heap should plateau instead of grow per reload (warm-up no longer fires unprompted).
- Manual: on mobile viewport (<768px), SceneToggle is absent and `data-scene` stays unset on `<div data-app-root>`.
- Manual: switch language → F5 → language persists.
- Existing tests: `src/i18n/__tests__/*`, `src/components/__tests__/SceneToggle.*`, `e2e/i18n.spec.ts`, `e2e/home-scene.spec.ts` — run unchanged; only the home prefetch test (if any) may need updating to the gated trigger.

## Files touched

- `src/i18n/provider.tsx` (race-safety on IP geo)
- `src/i18n/index.ts` (sessionStorage fallback in `detectLang`)
- `src/components/LanguageToggle.tsx` (contrast)
- `src/components/Flag.tsx` (ring + fetchpriority)
- `src/pages/Home.tsx` (mobile guard for SceneToggle, gated prefetch, clear scene on mobile)
- `src/components/note/topbar/Topbar.tsx` (mobile guard for SceneToggle)
- `src/components/home/SceneHost.tsx` (probe canvas cleanup)
