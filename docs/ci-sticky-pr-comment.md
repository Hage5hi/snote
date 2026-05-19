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

| Env var                    | Type              | Default  |
| -------------------------- | ----------------- | -------- |
| `STICKY_CLEANUP_STRATEGY`  | `delete` \| `lock`| `delete` |
| `STICKY_HEAD_SCAN_LINES`   | positive integer  | `5`      |
| `STICKY_DEBUG`             | `1` to enable     | off      |
| `GITHUB_TOKEN`             | PAT / job token   | required for live mode |
| `STICKY_REPO`              | `owner/repo`      | required for live mode |
| `STICKY_PR_NUMBER`         | PR number         | required for live mode |

If the GitHub envs are missing the script prints the resolved config
and exits `0` — the cleanup pass is best-effort, not a gate.

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
[sticky-upsert] done: action=updated id=987654321 cleaned=2 usedFullScan=false
```

## Exit codes

| Code | Meaning                                     |
| ---- | ------------------------------------------- |
| 0    | Upserted (created or updated); cleanup done |
| 1    | Bad flags / missing required input          |
| 2    | GitHub API error                            |
