## Goals

1. Right-click on the top-level "Back to home" arrow in Split view opens `/` in a new tab (parity with the single-note Home button).
2. Remove the redundant per-note Home arrow from each embedded NotePage inside Split view — keep only the single top-level one.
3. Extend Split view to support 3 and 4 slugs (route `/a+b`, `/a+b+c`, `/a+b+c+d`) with these layouts:
   - 2 notes → left | right (current)
   - 3 notes → top row split in two (note 1 | note 2), bottom row = note 3 full width
   - 4 notes → 2×2 grid

## Changes

### `src/pages/SplitView.tsx`
- Parse `slug.split("+")` into an array of 2–4 slugs. Validate each with `SLUG_RE`; redirect to `/` if any invalid or count outside 2..4. Deduplicate consecutive/identical slugs (if all identical → single note redirect; otherwise keep only unique to avoid provider conflicts, redirect to the joined unique path).
- Replace hard-coded `left`/`right` refs with an array of refs (`useRef<HTMLDivElement[]>`). Update sync-scroll effect to attach listeners across every pair of `.cm-scroller` elements so any pane drives the others (still gated by `syncScroll`).
- Add `onContextMenu` to the header's `<Link to="/">` that calls `e.preventDefault()` and `window.open("/", "_blank", "noopener,noreferrer")` — matches `TopbarBrand.tsx`.
- Header slug label shows all slugs joined with ` + `.
- `<main>` layout driven by count:
  - 2 → `grid-cols-1 md:grid-cols-2`
  - 3 → `grid-cols-1 md:grid-cols-2 md:grid-rows-2`, third pane spans `md:col-span-2`
  - 4 → `grid-cols-1 md:grid-cols-2 md:grid-rows-2`
- Update Helmet `<title>`, meta description, canonical, and og/twitter tags to use the joined slug list.

### `src/pages/NotePage.tsx`
- Add optional prop `embedded?: boolean` (default `false`). When embedded, pass through to `<Topbar embedded />`.
- Split view passes `embedded` alongside `embedSlug`.

### `src/components/note/topbar/Topbar.tsx` and `TopbarBrand.tsx`
- Add `embedded?: boolean` prop; forward from `Topbar` → `TopbarBrand`.
- In `TopbarBrand`, when `embedded` is true, do not render the Home `<Link>` + its tooltip. Everything else (slug copy, copy content, outline, sync indicator, tags) stays.

### Validation
- Manual: visit `/123+234`, `/a+b+c`, `/a+b+c+d`; verify layouts, single top-level Home button, right-click opens `/` in a new tab, left-click still navigates in place, sync scroll works across all panes.
- Existing tests unaffected; `e2e/topbar-home-right-click.spec.ts` continues to cover the single-note case.

## Out of scope
- No changes to routing beyond the existing `/:slug` dispatcher (still splits on `+`).
- No new i18n keys; header label stays as raw joined slugs.
- No changes to business logic in NotePage.
