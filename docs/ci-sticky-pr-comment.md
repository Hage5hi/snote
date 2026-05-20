# CI · Sticky PR comment upsert

`scripts/ci-sticky-pr-comment-upsert.ts` posts/updates a single sticky PR
comment per CI run and cleans up older duplicate marker comments that
may exist (manual pastes, races, comments older than the upsert logic
itself).

## Usage

```sh
bun run scripts/ci-sticky-pr-comment-upsert.ts \
  --marker "<!-- Sticky Pull Request Commenti18n-cli-coverage -->" \
  --body-file reports/_ci/coverage-pr-comment.md \
  [--cleanup-strategy delete|lock] \
  [--head-scan-lines 5] \
  [--debug]
```

`--help` prints the same flag matrix.

### Environment variables (lower precedence than flags)

| Env var                    | Type              | Default  | Mode |
| -------------------------- | ----------------- | -------- | ---- |
| `STICKY_CLEANUP_STRATEGY`  | `delete` \| `lock`| `delete` | both |
| `STICKY_HEAD_SCAN_LINES`   | positive integer  | `5`      | both |
| `STICKY_DEBUG`             | `1` to enable     | off      | both |
| `GITHUB_TOKEN`             | PAT / job token   | —        | **live only** |
| `STICKY_REPO`              | `owner/repo`      | —        | **live only** |
| `STICKY_PR_NUMBER`         | PR number         | —        | **live only** |

#### Live mode vs best-effort mode

- **Live mode** — all three of `GITHUB_TOKEN`, `STICKY_REPO`, and
  `STICKY_PR_NUMBER` must be set. The script calls the GitHub REST API
  to list/create/update/delete PR comments and performs the actual
  sticky upsert + duplicate cleanup. This is the mode used by the CI
  workflow.
- **Best-effort mode** — when any of those three live-mode envs is
  missing, the script prints the resolved config (and which envs were
  missing) and exits `0` without calling GitHub. Cleanup is best-effort,
  not a CI gate, so missing creds (e.g. local dry-run, forked PR with
  no token) must never fail the workflow.

CLI flags (`--cleanup-strategy`, `--head-scan-lines`, `--debug`) always
override the corresponding `STICKY_*` env vars. Invalid values passed
via a flag throw (CI should fail loudly); invalid values from env are
silently ignored and fall back to the default.

## `cleanupStrategy` — `delete` vs `lock`

When multiple comments carrying the sticky marker exist, the upsert
updates the **newest** (highest comment id, matching GitHub's monotonic
ordering) and handles the older duplicates per strategy:

| Strategy   | What happens to older duplicates            | When to use                                                 |
| ---------- | ------------------------------------------- | ----------------------------------------------------------- |
| `delete`   | Removed via `DELETE /issues/comments/:id`.  | **Default.** Bot has delete permission. Cleanest thread.    |
| `lock`     | Body rewritten to a tombstone marker-free.  | Bot lacks delete perm, or you want an audit trail of runs.  |

`--cleanup-strategy delete` silently falls back to `lock` if the API
client lacks delete capability — the thread still converges to a
single live marker.

## Wiring in `.github/workflows/ci.yml`

The `i18n` job invokes the script after the
`marocchino/sticky-pull-request-comment` post step:

```yaml
- name: Sticky PR comment — duplicate cleanup
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    STICKY_CLEANUP_STRATEGY: ${{ inputs.sticky_cleanup_strategy || 'delete' }}
    STICKY_HEAD_SCAN_LINES: ${{ inputs.sticky_head_scan_lines || '5' }}
    STICKY_DEBUG: ${{ inputs.sticky_debug || '0' }}
    STICKY_MARKER: '<!-- Sticky Pull Request Commenti18n-cli-coverage -->'
    STICKY_PR_NUMBER: ${{ github.event.pull_request.number }}
    STICKY_REPO: ${{ github.repository }}
  run: |
    bun run scripts/ci-sticky-pr-comment-upsert.ts \
      --marker "$STICKY_MARKER" \
      --body-file reports/_ci/coverage-pr-comment.md \
      --cleanup-strategy "$STICKY_CLEANUP_STRATEGY" \
      --head-scan-lines "$STICKY_HEAD_SCAN_LINES" \
      $( [ "$STICKY_DEBUG" = "1" ] && echo --debug )
```

The `workflow_dispatch` trigger exposes `sticky_cleanup_strategy`,
`sticky_head_scan_lines`, and `sticky_debug` so the matrix can be
toggled per-run from the Actions UI without editing the workflow.

## Marker scanning is bounded

- **Head scan** (default 5 lines): fast path, covers ~all real-world
  cases. Raise `STICKY_HEAD_SCAN_LINES` when bots prefix the comment
  body with non-trivial preamble (signatures, logs, quoted blocks).
- **Full-scan fallback**: runs only when the head scan finds zero
  matches across the entire thread, so deeply buried markers still
  trigger an update instead of a duplicate create.

## Debug output

With `--debug` (or `STICKY_DEBUG=1`):

```
[sticky-upsert] config: cleanupStrategy=delete headScanLines=5 marker="<!-- ... -->" bodyFile=reports/_ci/coverage-pr-comment.md
[sticky-upsert] selected newest sticky comment id=987654321 from 3 marker match(es); cleanup strategy=delete
[sticky-upsert] deleted older duplicate sticky comment id=987654300
[sticky-upsert] deleted older duplicate sticky comment id=987654289
[sticky-upsert] summary: action=updated id=987654321 cleaned=2 (deleted=2 tombstoned=0) requestedStrategy=delete effectiveStrategy=delete
[sticky-upsert] done: action=updated id=987654321 cleaned=2 usedFullScan=false
```

The `summary:` line is always emitted (when `--debug` is on) on both
created and updated paths. It reports the final cleaned count split by
strategy actually used (`deleted=` vs `tombstoned=`) and shows when the
requested strategy was downgraded — e.g. `requestedStrategy=delete
effectiveStrategy=lock` means the API client lacked delete permission
and the script fell back to tombstoning older duplicates.

## CI artifact gating: `STICKY_DEBUG`

The dedicated sticky-upsert perf step in `.github/workflows/ci.yml`
tees its vitest output to `reports/_ci/sticky-upsert-perf-timing.log`
**only** when `STICKY_DEBUG=1` (driven by the `sticky_debug`
workflow_dispatch input, default `'0'`).

| `sticky_debug` input | Perf log created? | Artifact uploaded? |
| -------------------- | ----------------- | ------------------ |
| unset (push / PR)    | no                | no                 |
| `'0'` (default)      | no                | no                 |
| `'1'`                | yes (tee’d)       | yes (`actions/upload-artifact@v4`) |

Three independent gates enforce this, all using the exact expression
`inputs.sticky_debug == '1'` (or its shell equivalent
`[ "$STICKY_DEBUG" = "1" ]`):

1. **Tee gate** — the perf step only writes the log inside an
   `if [ "$STICKY_DEBUG" = "1" ]` branch.
2. **Defensive purge** — a step gated on
   `inputs.sticky_debug != '1'` runs
   `rm -f reports/_ci/sticky-upsert-perf-timing.log`, so a stale log
   from a cached / restored workspace can’t survive a non-debug run.
3. **Upload gate** — the `actions/upload-artifact@v4` step’s `if:`
   includes `inputs.sticky_debug == '1'`.

If any of these three expressions drifts (different operand, different
value, removed entirely),
`scripts/__tests__/ci-sticky-upsert-debug-gating-drift.test.ts` fails
the CI job. That guard is the single source of truth for the artifact
contract — change the expressions and the test together, or not at all.

## Perf regression budgets (configurable per environment)

The perf regression suite
(`scripts/__tests__/ci-sticky-upsert-bulk-cleanup-perf-regression.test.ts`)
has generous defaults but exposes env-var overrides so each CI
environment can tune budgets without touching the test source:

| Env var                       | Effect                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `STICKY_PERF_CAP_MS_<N>`      | Absolute wall-clock cap (ms) for the cleanup of N duplicates, where N ∈ {100, 500, 2000, 5000}. |
| `STICKY_PERF_RATIO_MAX`       | Maximum allowed per-item cost ratio between the largest and smallest N (linearity guard). Default `4`. |
| `STICKY_PERF_MEM_CAP_MB`      | Optional. When set, the test asserts `process.memoryUsage().heapUsed` delta per N is below the cap (MB). Unset disables the memory check. |

## Per-scenario telemetry artifacts

When `STICKY_TEST_SUMMARY=1`, the test helper emits two outputs per
scenario:

1. A compact human-readable `[sticky-scan] <label> action=… id=… …`
   line on stdout.
2. A machine-readable `[sticky-scan-json] {...}` line on stdout AND
   the same record appended (one JSON object per line) to
   `reports/_ci/sticky-scan-summary.jsonl` (override path via
   `STICKY_SCAN_SUMMARY_JSONL`). Records carry the
   `sticky-scan-summary/v1` schema tag.

## Fuzz failure replay artifacts

When any fuzz test driven by `runFuzzWithSeed` fails, the helper
writes a JSON file to
`reports/_ci/sticky-fuzz-failures/<name>-seed<S>-iter<I>.json`
(override via `STICKY_FUZZ_ARTIFACT_DIR`). The artifact carries the
`sticky-fuzz-failure/v1` schema tag and includes the seed, iteration
index, marker literal, marker variant generated by the fuzzer, both
matcher return values (head-scan and full-scan paths), any thrown
errors, and any computed cleaned IDs (or `null` when the test is
matcher-only). Replay with:

```sh
STICKY_FUZZ_SEED=<seed> bunx vitest run <file>
```

## Replay CLI for pagination-overlap diagnostics

`scripts/ci-sticky-newest-wins-overlap-replay.ts` reruns the stubbed
pages used by the `newest-wins-pagination-overlap` integration test
against the real `upsertStickyComment` and prints `scanStats`,
selected id, cleaned ids, and final thread state. Useful when the
integration test goes red on CI and you want a focused local repro
without re-running the full vitest suite.

```sh
bun run scripts/ci-sticky-newest-wins-overlap-replay.ts \
  --scenario overlap-dup-page
```


## Exit codes

| Code | Meaning                                     |
| ---- | ------------------------------------------- |
| 0    | Upserted (created or updated); cleanup done |
| 1    | Bad flags / missing required input          |
| 2    | GitHub API error                            |
