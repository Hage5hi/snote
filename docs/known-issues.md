# Known Issues

## y-codemirror.next: "Calls to EditorView.update are not allowed while an update is in progress"

**Status:** Pre-existing upstream bug in `y-codemirror.next` (≤ 0.3.5). Not introduced by Phase 2.5 broadcast batching.

**Trigger:** First `mousedown` inside the editor after focus/cursor change in collaborative mode.

**Stack signature:**
```
EditorView.update
  → dispatchTransactions → dispatch
    ← YRemoteSelectionsPluginValue._listener (y-codemirror.next/y-remote-selections.js)
    ← Awareness.emit ← Awareness.setLocalState ← setLocalStateField
    ← YRemoteSelectionsPluginValue.update
  ← updatePlugins ← EditorView.update ← dispatch ← mousedown handler
```

**Root cause:** `YRemoteSelectionsPluginValue` is both an `awareness 'change'` listener (which calls `view.dispatch`) and an updater that calls `awareness.setLocalStateField('cursor', …)` synchronously inside its own `update()`. The synchronous awareness emit re-enters the plugin's listener while CodeMirror is still inside the outer `update()` cycle, which CM6 forbids. CodeMirror logs the exception but **does not crash** — the editor remains functional and recovers on the next dispatch.

**Upstream fix:** `yjs/y-codemirror.next` PR #39 — "fix: prevent nested EditorView.update errors" (open as of 2026-01).

**Why we are not patching locally:**
- Functionally harmless (logged, swallowed by CM's `logException`, editor continues).
- Patching would require either a `setTimeout(0)` shim around `setLocalStateField` (risk: cursor-presence lag) or a vendored fork.
- Independent of provider/sync code; will resolve when we bump `y-codemirror.next` after PR #39 lands.

**Verification that Phase 2.5 (broadcast batching, commit `ca4ebcc`) is NOT the cause:**
- Diff scope: only `handleDocUpdate` → `queueBroadcast`/`flushBroadcasts`. No change to `handleAwarenessUpdate`, `broadcastAwareness`, or any `setLocalState*` call.
- Stack frames contain zero `provider.ts` references.
- Trigger path (mousedown → CM transaction → plugin.update → setLocalStateField) is fully synchronous inside CodeMirror and independent of the rAF batch loop, which only defers `channel.send`.
