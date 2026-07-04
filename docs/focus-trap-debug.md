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
