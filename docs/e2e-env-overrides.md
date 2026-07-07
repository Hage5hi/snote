# E2E Test Environment Overrides

This document lists the environment variables and runtime overrides available to
Playwright / Vitest suites so CI and local runs share consistent timing.

## `YJS_SNAPSHOT_DEBOUNCE_MS` (and friends)

The Yjs provider debounces `ydoc_state` upserts so rapid edits don't hammer the
database. The rename-race tests need to tune this so the debounce window is
predictable across machines. Resolution order (highest priority first):

| Source | Scope | Example |
| --- | --- | --- |
| `localStorage["syrin:yjs-snapshot-debounce-ms"]` | Per-page (Playwright injects via `addInitScript`) | `page.addInitScript(() => localStorage.setItem("syrin:yjs-snapshot-debounce-ms","300"))` |
| `import.meta.env.VITE_YJS_SNAPSHOT_DEBOUNCE_MS` | Browser build (Vite) | `.env.test` → `VITE_YJS_SNAPSHOT_DEBOUNCE_MS=400` |
| `process.env.YJS_SNAPSHOT_DEBOUNCE_MS` | Vitest / Node | `YJS_SNAPSHOT_DEBOUNCE_MS=200 bunx vitest run` |
| built-in default | — | **800 ms** |

Implementation: `src/lib/yjs/provider.ts` → `getSnapshotDebounceMs()`.

### Recommended values

| Context | Value | Why |
| --- | --- | --- |
| CI (GitHub Actions) | `400` | Faster suite while still exercising the debounce path |
| Local Playwright | `300` | Snappy manual reruns |
| Rename-race stress test | randomized `100–800` | Fuzz the resurrection window |
| Production default | `800` | Balances DB writes vs. crash recovery |

### Setting it in Playwright specs

```ts
const page = await context.newPage();
await page.addInitScript((ms) => {
  localStorage.setItem("syrin:yjs-snapshot-debounce-ms", String(ms));
}, 300);
```

Helper: `newPageWithDebounce(context, ms)` in `e2e/note-rename-yjs-race.spec.ts`.

## Related overrides

- `syrin:yjs-snapshot-debounce-ms` also drives the finalize/deletion-confirm
  polling window in `src/lib/rename.ts` (`waitForSlugDeletionConfirmed`).
- The `old-slug-cleanup-status` edge function logs `dbMs`/`totalMs` metrics —
  grep CI logs for `[cleanup-status]` when a resurrection is suspected.
