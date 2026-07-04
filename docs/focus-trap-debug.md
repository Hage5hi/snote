# Focus-trap debug workflow

Fast reference for reproducing, capturing, and inspecting install-prompt
focus-trap failures.

## When to reach for this

- A Playwright spec under `e2e/install-prompt-*.spec.ts` fails on
  `expectFocusInsideDialog`.
- CI uploads a `focus-trap-escape-*.json` in the
  `install-prompt-focus-trap-debug-attempt-N` artifact bundle.
- You're on-call and need to know *which* Tab/Shift+Tab escaped the trap
  and what the DOM looked like at that moment.

## Env vars (set locally or in CI)

| Var | Default | Purpose |
| --- | --- | --- |
| `IP_REOPEN_COUNT` | `4` | Loop bound in `install-prompt-rapid-reopen-once.spec.ts`. Set via `-c N`. |
| `IP_CAPTURE_DISABLED` | `0` | `1` = skip screenshot + HTML capture on focus-trap failure. `--no-capture`. |
| `IP_HTML_MAX` | `200000` | Max bytes for the HTML snapshot written next to the JSON. `--html-max-size N`. |
| `IP_ARTIFACT_BASE_URL` | *unset* | When set, each `focus-trap-escape-*.json` includes `artifactUrls` deep links built as `${BASE}/${relativeOutputDir}/${file}`. CI sets this to the run's artifacts URL. |

## Local repro

```bash
# Rapid-reopen scenario, 20 opens, stop at first focus-trap failure:
./scripts/debug-install-prompt-focus.sh -c 20

# A specific spec on Firefox with 2 PW retries, disable HTML capture:
./scripts/debug-install-prompt-focus.sh \
  -s e2e/install-prompt-shift-tab-after-backdrop.spec.ts \
  -b firefox -r 2 --no-capture

# All flags:
./scripts/debug-install-prompt-focus.sh --help
```

Each failure writes, next to the test's `outputDir`:

- `focus-trap-escape-<label>.json` — full payload (history, timings,
  relocate path, `artifacts`, `artifactUrls`)
- `focus-trap-escape-<label>.png` — screenshot at moment of failure
- `focus-trap-escape-<label>.html` — sanitized page HTML (input values
  redacted, `<script>`/`on*` handlers stripped)

## Inspect (console + summary + CSV)

```bash
# Print first-failure summary for every focus-trap-escape-*.json under
# test-results/. Writes reports/_ci/focus-trap-inspect-summary.json.
bun run scripts/inspect-focus-trap.ts

# Filter by attempt / browser / spec / label; also emit a CSV row per
# matched failure for CI ingestion:
bun run scripts/inspect-focus-trap.ts \
  --attempt 2 --browser chromium \
  --spec install-prompt-rapid-reopen-once \
  --csv reports/_ci/focus-trap-inspect-summary.csv
```

### Validate-only fast-fail

```bash
# Recursively validate every focus-trap-escape-*.json under test-results/,
# exit 2 on the first invalid file. Deterministic sorted order.
bun run scripts/inspect-focus-trap.ts --validate-only

# Cap invalid-file console output but still scan (and quarantine) every file:
bun run scripts/inspect-focus-trap.ts --validate-only --max-errors 5
```

### jq recipes over `focus-trap-inspect-summary.json`

Every entry always carries `failureReason`, `failureKind`
(`parse` | `schema` | `escape` | `null`), `schemaPointer`, and
`quarantined`, so triage is a single `jq` filter away:

```bash
S=reports/_ci/focus-trap-inspect-summary.json

# All invalid artifacts (parse or schema errors):
jq '.entries[] | select(.failureKind=="parse" or .failureKind=="schema")' $S

# Schema failures grouped by JSON-pointer of the offending field:
jq '[.entries[] | select(.failureKind=="schema")] | group_by(.schemaPointer)
    | map({pointer:.[0].schemaPointer, count:length})' $S

# Escapes only (well-formed payloads with a real focus-trap failure):
jq '.entries[] | select(.failureKind=="escape")
    | {spec, browser, attempt, label, failureReason}' $S

# Everything that got quarantined + its copied-out path:
jq '.entries[] | select(.quarantined != "") | {file, quarantined, failureReason}' $S

# Distinct failureReason values with counts:
jq '[.entries[].failureReason] | group_by(.) | map({reason:.[0], count:length})' $S

# Just the quarantined file paths (newline-separated, feed into xargs):
jq -r '.entries[] | select(.quarantined != "") | .quarantined' $S

# Deduplicated set of schemaPointer values across all schema failures:
jq -r '[.entries[] | select(.failureKind=="schema") | .schemaPointer]
       | unique | .[]' $S
```

### Machine-readable JSON report (`--json-report`)

Focused report separate from the full summary — always includes
`valid` / `invalid` counts, an `artifacts[]` list sorted by `file`
(stable across runs), and an `issues[]` list restricted to parse /
schema failures. Safe to diff two runs' reports byte-for-byte.

```bash
bun run scripts/inspect-focus-trap.ts \
  --scan-root test-results \
  --json-report reports/_ci/focus-trap-inspect-report.json

# Every schema failure with its JSON pointer + quarantined path:
jq '.issues[] | select(.failureKind=="schema")
    | {file, schemaPointer, quarantined, failureReason}' \
   reports/_ci/focus-trap-inspect-report.json

# Deduplicated schemaPointer set straight from the report:
jq -r '[.issues[] | select(.failureKind=="schema") | .schemaPointer]
       | unique | .[]' \
   reports/_ci/focus-trap-inspect-report.json
```

### HTML triage report (`--html-report` / `--html-top-n`)

`--html-report PATH` renders a standalone triage page from the same
scan: top-N `failureKind` and `schemaPointer` tables, then a
`Quarantined artifacts` table showing the top-N entries with a
collapsible `<details>` block that expands to every quarantine entry.

`--html-top-n N` controls how many rows show in the top tables and in
the always-visible quarantine slice. **Default: value of `--top`
(currently `5`).** The collapsible section always lists every
quarantined artifact regardless of `--html-top-n`.

```bash
bun run scripts/inspect-focus-trap.ts \
  --scan-root test-results \
  --json-report reports/_ci/focus-trap-inspect-report.json \
  --html-report reports/_ci/focus-trap-inspect-report.html \
  --html-top-n 10
```

### Diff two runs (`--diff-with` / `--diff-out`)


Point `--diff-with` at a directory holding the previous run's
`*.valid.csv` / `*.invalid.csv` (typically the downloaded
`focus-trap-inspect-valid--…` / `…-invalid--…` artifacts). Rows are
matched by `file`; the diff surfaces any change in `failureReason`
**or** `schemaPointer`. `--diff-out` writes a stable, sorted CSV with
header `file,prevFailureReason,prevSchemaPointer,currFailureReason,currSchemaPointer`.

```bash
# Download prev run's artifacts:
gh run download <prev-run-id> \
  -n focus-trap-inspect-invalid--test-results--<sha>--attempt-1 \
  -D /tmp/ft-prev
gh run download <prev-run-id> \
  -n focus-trap-inspect-valid--test-results--<sha>--attempt-1 \
  -D /tmp/ft-prev

# Diff the current run against it — CSV + JSON side-by-side:
bun run scripts/inspect-focus-trap.ts \
  --scan-root test-results \
  --diff-with     /tmp/ft-prev \
  --diff-out      reports/_ci/focus-trap-inspect-diff.csv \
  --diff-json-out reports/_ci/focus-trap-inspect-diff.json
```

### Machine-readable diff (`--diff-json-out`)

`--diff-json-out PATH` writes the same changed rows as `--diff-out`, but
as JSON so downstream automation (bots, dashboards) does not need to
re-parse CSV. Rows are sorted by `file` and re-runs on identical inputs
are byte-stable (modulo `generatedAt` / `meta.timestamp`).

```jsonc
{
  "generatedAt": "2026-07-04T…Z",
  "meta": {
    "gitSha": "abc123…",
    "scanRoot": "test-results",
    "argv": ["--scan-root", "test-results", "--diff-with", "/tmp/ft-prev", …],
    "timestamp": "2026-07-04T…Z",
    "ciRunId": "12345",
    "ciRunAttempt": "1"
  },
  "diffWith": "/tmp/ft-prev",
  "changed": 2,
  "rows": [
    {
      "file": "test-results/a-spec-chromium-retry0/focus-trap-escape-x.json",
      "prevFailureReason": "",
      "prevSchemaPointer": "",
      "currFailureReason": "schema: /focusHistory/0/event [event]: expected string",
      "currSchemaPointer": "/focusHistory/0/event"
    }
  ]
}
```

### Validate reports without writing (`--report-validate-only`)

Runs the schema/header validators against the shapes the CLI would
otherwise write (`--json-report`, `--diff-out`, `--diff-json-out`,
`--html-report`, `--csv`, `--md`, and the step-summary) and exits:

- `0` — every shape is well-formed. **No artifacts written.**
- `65` — `validateJsonReport` / `validateDiffCsvHeader` reported errors
  (missing/reordered columns, missing required keys). Nothing written.
- `2` — invalid focus-trap-escape artifacts were found (unchanged from
  the normal run). Still nothing written.

```bash
# Dry-run in CI to prove the artifact shapes are still contract-compliant
# before a "real" upload step runs:
bun run scripts/inspect-focus-trap.ts \
  --scan-root test-results \
  --json-report reports/_ci/focus-trap-inspect-report.json \
  --diff-with /tmp/ft-prev \
  --diff-out  reports/_ci/focus-trap-inspect-diff.csv \
  --diff-json-out reports/_ci/focus-trap-inspect-diff.json \
  --report-validate-only
```





## Replay a captured DOM offline

```bash
./scripts/replay-focus-trap.sh \
  test-results/<spec>-<browser>-retry1/focus-trap-escape-<label>.json
```

Opens `/tmp/focus-trap-replay/index.html` in your browser: iframed DOM
snapshot on the left, screenshot + JSON on the right, and a full
**focus transition timeline** at the bottom. Click any step to
highlight the recorded `activeElement` inside the DOM snapshot — the
matcher prefers stable selectors (`id` → `data-testid` → `aria-label`
→ `name` → `role`+text) before falling back to `outerHTML` prefix.

## CI artifacts

Per-attempt artifact bundles uploaded when install-prompt specs fail:

- `install-prompt-focus-trap-debug-attempt-N.zip` — raw
  `focus-trap-escape-*.json` files + `focus-trap-debug-index.json`.
- `install-prompt-focus-trap-inspect-attempt-N.zip` — the inspect
  summary (`.json` + `.csv` + `.md`), plus `focus-trap-inspect-summary.valid.csv`
  / `.invalid.csv` (from `--csv-filter valid|invalid`), the debug index,
  and the raw JSON / PNG / HTML files. Layout inside the ZIP mirrors
  `IP_ARTIFACT_BASE_URL` so the `artifactUrls.pageHtml` / `.screenshot`
  links in each JSON resolve when the artifact is served.

- `install-prompt-failure-evidence-attempt-N.zip` — screenshots,
  videos, traces, and JSON attachments produced by Playwright itself.

npm shortcuts:

```bash
bun run test:e2e:debug:install       # headed local repro
bun run test:e2e:inspect:focus-trap  # print + summary
bun run test:e2e:replay:focus-trap <focus-trap-escape-*.json>
```
