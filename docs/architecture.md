# Syrin Notes — Architecture

Snapshot after Phase 7 (PWA shell + Web Vitals primer). Update when new phases land.

## Overview

- React 18 + Vite 5 + TypeScript SPA
- Yjs CRDT for note state, persisted locally via `y-indexeddb` and remotely via Supabase Realtime + Postgres
- Markdown rendering: `marked` + DOMPurify inside a Web Worker, with mermaid/katex/hljs lazy-loaded and hydrated post-render
- PWA shell via Workbox precache, offline-first for the app shell

## 1. Sync Architecture (Phase 2.1, 2.2, 2.5)

`src/lib/yjs/provider.ts` — `SupabaseYjsProvider`:

- Broadcasts `Y.update` binary over a Supabase Realtime channel `note:<slug>`
- Batched via `requestAnimationFrame` + `Y.mergeUpdates` (Phase 2.5) → ≤60 broadcasts/s
- Postgres snapshot debounced 800 ms into `notes.ydoc_state` (atomic with the `notes.content` plaintext)
- Awareness (presence + cursor) ping every 15 s
- `beforeunload` flush via `navigator.sendBeacon`

`SyncEvent` stream (Phase 2.1) — 6 states:
`synced-durable | conflict | recovered | error | offline | online`

UI: `useSyncStatus` hook + `<SyncIndicator>` pill (Phase 2.2, 5 visual states + popover).

## 2. Render Pipeline (Phase 3.1, 3.2, 5, 6)

`src/components/note/Preview.tsx` flow:

```text
text → expandWikiLinks → LRU cache (size 50) → [worker: marked + DOMPurify]
       → setHtml → hydration useEffect
            ├─ mermaid: incremental (sequential + rIC yield), SVG cache size 30 keyed `${theme}:${code}`
            ├─ katex: parallel forEach
            └─ hljs:  parallel forEach
```

- **LRU render cache** (Phase 3.2): key = post-`expandWikiLinks` text. Hit skips the worker entirely.
- **Worker render** (Phase 5): `src/lib/markdown/preview-worker.ts` runs `marked.parse` + `DOMPurify.sanitize` off the main thread. Returns sanitized HTML with `data-*` placeholders for mermaid/katex/hljs.
- **Mermaid hydration** (Phase 6): sequential `hydrateOneMermaid(index)`, `await yieldIdle()` (`requestIdleCallback` fallback `setTimeout(0)`) between blocks. SVG cache size 30.
- **Stale guard**: `__hydrationToken` Symbol — async hydration drops results if `html` or theme changed mid-flight.

## 3. Lazy Loading (Phase 3.1)

Chunks lazy-loaded (only fetched when route/feature uses them):

- `mermaid-vendor` — Preview encounters a ```` ```mermaid ```` block
- `katex-vendor` — Preview encounters `$$math$$`
- `hljs-vendor` — Preview encounters a code block with a language hint
- vim chunk — Editor toggles vim mode
- `preview-worker-*` — Loaded when `new Worker()` runs

`vite.config.ts` uses `modulePreload.resolveDependencies` to filter lazy-only chunks out of the `<link rel="modulepreload">` list emitted into `index.html`.

## 4. PWA Shell (Phase 7)

`vite-plugin-pwa` config:

- `manifest: false` — keep the hand-tuned `public/manifest.webmanifest`
- `registerType: "autoUpdate"` — SW `skipWaiting` + `claim`, no forced reload
- Workbox precache JS/CSS/HTML/icons. `globIgnores` excludes `mermaid-vendor`, `wardley`, `preview-worker`
- `navigateFallback: /index.html` + denylist `/api/`, `/auth/`
- `public/sw-kill.js` — emergency rollback worker (not deployed; rename to `sw.js` + redeploy if needed)
- `public/offline.html` — fallback page

Web Vitals primer: `src/main.tsx` lazy-imports `web-vitals` → console-logs `[perf] INP/LCP/CLS`.

## 5. Performance Budget (Phase 8)

`scripts/check-bundle-size.ts` — gzips each chunk and compares against a threshold table. Runs in CI after `vite build` via the `build:check` script. Three checks:

1. Per-chunk threshold table (entry, react/supabase/radix/yjs/md vendors, admin chunk).
2. Initial route preload total ≤ 250 KB gz (entry + all `modulepreload` chunks).
3. Invariant: `mermaid-vendor`, `katex-vendor`, `hljs-vendor`, `wardley`, `preview-worker` must NOT appear in the `modulepreload` list.

Initial preloaded chunks: entry + `react-vendor` + `supabase-vendor` + `radix-vendor` + `md-vendor` + `chunk-a8f3`.
Lazy chunks: mermaid / katex / hljs / vim / preview-worker / wardley / `NotePage` / `cm-vendor` / etc.

## 6. Cleanup (Phase 4)

Removed: `StatusPill.tsx` (legacy, redundant with `SyncIndicator`), `SaveStatus` type, and the `onStatus` / `statusListeners` chain inside `provider.ts` (state info is now fully covered by `SyncEvent`).

## 7. Known Issues

See `docs/known-issues.md`:

- `y-codemirror.next` re-entrancy bug (upstream PR #39 pending).
