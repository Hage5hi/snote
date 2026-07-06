# Syrin Notes

Realtime markdown notes by URL. Create, share, and edit notes that sync across devices and work offline.

**Live:** [syrin.online](https://syrin.online/)

## Features

- **Instant notes by URL** — visit `syrin.online/my-note` to create or open a note
- **Realtime sync** — edits sync across devices via Supabase Realtime + Yjs CRDT
- **Offline support** — PWA with IndexedDB persistence, works without connectivity
- **Markdown editor** — CodeMirror 6 with syntax highlighting, Vim mode, and typewriter mode
- **Live preview** — rendered markdown with KaTeX math, Mermaid diagrams, and code highlighting
- **Split view** — side-by-side editor + preview (e.g. `syrin.online/my-note+preview`)
- **Share links** — revocable token-based read-only sharing (`/s/:token`)
- **Encryption** — optional passphrase-based note locking
- **Note history** — snapshot diffs to review past edits
- **Tags & pinning** — organize notes with tags and pin favorites
- **Word count & goals** — track progress with word count and configurable targets
- **Zen mode & focus line** — distraction-free writing modes
- **E-ink mode** — optimized display for e-ink screens
- **Command palette** — quick access to actions via keyboard
- **i18n** — English, Vietnamese, Chinese, Japanese, Korean, French, Spanish
- **Dark / light theme** — system-aware with manual toggle
- **Presence indicators** — see who else is viewing a note
- **SEO prerendering** — Cloudflare Worker serves OpenGraph meta to crawlers

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Editor:** CodeMirror 6, Yjs (CRDT)
- **Backend:** Supabase (Postgres, Realtime, Edge Functions)
- **Prerender:** Cloudflare Worker ([details](cloudflare-worker/README.md))
- **Testing:** Vitest (unit), Playwright (e2e)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (or [Bun](https://bun.sh/))

### Setup

```sh
git clone https://github.com/Hageshiku/snote.git
cd snote
bun install      # or: npm install
bun run dev      # start dev server at http://localhost:5173
```

Copy `.env.example` to `.env` if not already present — it contains the public Supabase keys needed for local development.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (zero warnings) |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | E2E tests (Playwright) |
| `npm run preview` | Preview production build |

## Project Structure

```
src/
  components/     # UI components (note/, admin/, ui/)
  hooks/          # Custom React hooks
  i18n/           # Internationalization
  integrations/   # Supabase client
  pages/          # Route pages (Home, NotePage, SplitView, etc.)
cloudflare-worker/  # Prerender worker for SEO
supabase/           # Migrations and edge functions
e2e/                # Playwright end-to-end tests
docs/               # Architecture and i18n docs
```

## i18n Allowlist — Pre-commit Hook

This repo ships a Git pre-commit hook that runs the i18n hardcoded-string
allowlist gate locally so drift (missing or stale `eslint-disable`
entries) is caught before it reaches CI. See
[`docs/i18n-allowlist-report.md`](docs/i18n-allowlist-report.md) for what
the report fields mean.

### Install

Run once per clone (also runs automatically via `prepare` after
`bun install` / `npm install`):

```sh
bun run hooks:install
# or, manually:
git config core.hooksPath .githooks
```

### Verify

Confirm the hook is wired and the gate currently passes:

```sh
git config --get core.hooksPath          # → .githooks
bun run i18n:allowlist:report            # prints schemaOk / driftOk / missing / stale
```

The hook script lives at [`.githooks/pre-commit`](.githooks/pre-commit)
and shells out to `bun run i18n:allowlist:report`.

### Bypass (emergency only)

If you genuinely need to commit while the gate is failing (e.g. WIP),
skip the hook with:

```sh
git commit --no-verify -m "wip: …"
```

CI will still run the same check on the PR, so don't ship code that
relies on bypassing.

## Visual regression CLI — `--scene-diff` / `--chrome-diff`

The Playwright scene specs accept two independent pixel-diff threshold
axes, plumbed through the `e2e:*:changed` wrapper scripts and into the
`SCENE_DIFF_RATIOS`, `CHROME_DIFF_RATIO`, and `CHROME_SCENE_DIFF_RATIOS`
env vars that `e2e/helpers/pixel-diff.ts` reads.

| Flag | What it controls | Repeatable | Glob? |
|---|---|---|---|
| `--scene-diff <id\|glob>=<ratio>` | Masked scene layer + hit-test specs | Yes | Yes |
| `--chrome-diff <ratio>` | Chrome screenshot (Header / slug input / Recents), global | No | No |
| `--chrome-scene-diff <id\|glob>=<ratio>` | Chrome screenshot, per scene | Yes | Yes |
| `--strict-scene-diff` | Exit non-zero on unknown id / empty glob | — | — |

Always **quote globs** so the shell doesn't try to expand them against
your working directory:

```sh
# Loosen one scene
bun run test:e2e:update:changed --scene-diff neon-vapor=0.05

# Tighten chrome globally while keeping shader scenes loose
bun run test:e2e:changed --chrome-diff 0.015 --scene-diff "neon-*=0.05"

# Tune a whole family + override one member tighter
bun run test:e2e:changed \
  --scene-diff "ethereal-*=0.04" \
  --scene-diff "obsidian-ink=0.012"

# Per-scene chrome thresholds via glob
bun run test:e2e:changed --chrome-scene-diff "neon-*=0.02"

# Fail loudly on a typo during a baseline update
bun run test:e2e:update:changed --strict-scene-diff --scene-diff neon-vapr=0.05
```

Precedence when multiple flags overlap the same scene id is **last
flag wins** — a later literal overrides an earlier wildcard match and
vice versa. The CI summary renders a `Scene-diff wildcard expansions`
table only when failures are present, focused on patterns that touched
a failing scene.

## Updating the focus-trap JSON Schemas

The `--json-report` and `--diff-json-out` outputs of
`scripts/inspect-focus-trap.ts` are pinned by published Draft-07 schemas
in `schemas/` (`focus-trap-inspect-report.schema.json`,
`focus-trap-inspect-diff.schema.json`). Downstream consumers validate
against `schemaVersion`, so any change to the artifact shape is a
coordinated 4-step update:

1. **Edit the schema(s)** in `schemas/`. Bump the `schemaVersion`
   `const` value if the change is not backwards-compatible.
2. **Sync the CLI constants** in
   `scripts/_helpers/focus-trap-inspect.ts` — `JSON_REPORT_SCHEMA_VERSION`
   and/or `DIFF_JSON_SCHEMA_VERSION` must match the schema `const`. CI
   fails otherwise (`CLI schemaVersion must match published JSON Schemas`).
3. **Regenerate the TypeScript types** used by code and tests:

   ```sh
   bun run schema:types            # regenerate
   bun run schema:types:check      # fail if the .gen.ts would change
   ```

   The pre-commit hook runs `schema:types:check` automatically when
   `schemas/focus-trap-inspect-*.schema.json` or the generator is staged.
4. **Validate + run the tests**:

   ```sh
   # Ajv-validate a real CLI run against the pinned schemas
   bunx ajv validate \
     -s schemas/focus-trap-inspect-report.schema.json \
     -d reports/_ci/focus-trap-inspect-report.json
   bunx ajv validate \
     -s schemas/focus-trap-inspect-diff.schema.json \
     -d reports/_ci/focus-trap-inspect-diff.json

   # Unit + integration: schema, negative, determinism, byte-identical
   bun run test scripts/__tests__/focus-trap-json-schemas.test.ts
   bun run test scripts/__tests__/focus-trap-json-schemas-negative.test.ts
   bun run test scripts/__tests__/focus-trap-diff-json-determinism.test.ts
   bun run test scripts/__tests__/focus-trap-diff-json-byte-identical.test.ts
   bun run test scripts/__tests__/focus-trap-schema-types.test.ts

   # e2e a11y for the HTML triage report
   bun run test:e2e e2e/focus-trap-html-report-a11y.spec.ts
   ```

### Previewing drift locally with `schema-guard`

Instead of waiting for the CI `schema-guard` workflow to reject a PR,
you can preview the exact same regeneration + diff bundle locally. The
local script uses the **same commands, artifact directory, and file
list as CI** (`bun run schema:types` / `schema:types:check`, output
under `_schema_drift/`), so the diffs you see match what CI would
upload as the `schema-drift` artifact byte-for-byte.

```sh
bun run schema-guard              # dry-run: regen + print diffs, exits 0
bun run schema-guard -- --strict  # parity with CI: exits 1 on drift
bun run schema-guard:view         # side-by-side viewer for the diffs
bun run schema-guard:view types   # just the .types.gen.ts diff
bun run schema-guard:view schemas # just the two schema JSON diffs

# Preview without a bundle on disk (planning / CI dry-run).
# Prints MATCH/SKIP lines and the exact diff/view command per file.
bun run schema-guard:view -- --dry-run
bun run schema-guard:view -- --dry-run --type schemas --viewer diff-y

# --file is repeatable AND accepts comma-separated substrings, so you can
# narrow to several bases in a single invocation without rerunning.
bun run schema-guard:view -- --file report --file diff
bun run schema-guard:view -- --file report,types.gen

# --browsers scopes the manifest + viewer output to a subset of Playwright
# projects (matches the CI matrix names). Comma-separated or repeatable.
bun run schema-guard:view -- --browsers chromium,firefox
bun run schema-guard:view -- --browsers chromium --browsers webkit

# --exclude drops noisy bases (applied after --file). Repeatable + CSV.
bun run schema-guard:view -- --exclude diff
bun run schema-guard:view -- --file schema --exclude report,diff

# --verbose traces matched files, resolved viewer commands, and echoes
# subprocess output to stderr — useful when debugging CI runs.
bun run schema-guard:view -- --verbose --dry-run

# Real-world combos
bun run schema-guard:view -- --type schemas --viewer diff-y --browsers chromium
bun run schema-guard:view -- --file report --file types.gen --viewer delta
bun run schema-guard:view -- --browsers chromium,firefox --exclude diff --viewer cat

# --manifest-dir writes machine-readable JSON (one file per browser)
# that downstream CI steps can consume. Combine with --manifest-prefix
# to control the filename and --combined-manifest to also emit a single
# aggregate file across every selected browser.
bun run schema-guard:view -- \
  --manifest-dir reports/_ci \
  --manifest-prefix drift \
  --browsers chromium,firefox,webkit \
  --exclude diff \
  --combined-manifest
# → reports/_ci/drift-chromium.json
#   reports/_ci/drift-firefox.json
#   reports/_ci/drift-webkit.json
#   reports/_ci/drift-combined.json   (browsers: [chromium,firefox,webkit])

# --require pins the CI-side expected artifact filenames per browser and
# persists them into every emitted manifest as `requiredArtifacts` so the
# downstream `e2e-live-region-verify` job knows exactly what to enforce.
# Repeatable AND comma-separated — pick whichever reads better in your CI.
#
# Example A — chromium only, single required trace:
bun run schema-guard:view -- \
  --manifest-dir reports/_ci --manifest-prefix drift \
  --browsers chromium \
  --require live-region-trace.zip
# → reports/_ci/drift-chromium.json:
#     "requiredArtifacts": ["live-region-trace.zip"]
#
# Example B — firefox, trace + failure screenshot (CSV form):
bun run schema-guard:view -- \
  --manifest-dir reports/_ci --manifest-prefix drift \
  --browsers firefox \
  --require live-region-trace.zip,live-region-failure.png
# → reports/_ci/drift-firefox.json:
#     "requiredArtifacts": ["live-region-trace.zip","live-region-failure.png"]
#
# Example C — full matrix + combined manifest (repeatable form):
bun run schema-guard:view -- \
  --manifest-dir reports/_ci --manifest-prefix drift \
  --browsers chromium,firefox,webkit \
  --require live-region-trace.zip \
  --require live-region-failure.png \
  --require dom-snapshot.html \
  --combined-manifest
# → reports/_ci/drift-{chromium,firefox,webkit,combined}.json each contain:
#     "requiredArtifacts": ["live-region-trace.zip","live-region-failure.png","dom-snapshot.html"]

# --validate-manifest re-reads every <prefix>-*.json in --manifest-dir
# and asserts the required top-level keys (browser, browsers, combined,
# generatedAt, type, viewer, resolvedViewerCommand, matches, excludes,
# expected, matched, requiredArtifacts). No diff/viewer runs. Failures
# are printed per-file with a `[combined]` or `[browser=<name>]` label
# and a `missing: ...` / `mistyped: ...` list.
bun run schema-guard:view -- --manifest-dir reports/_ci --manifest-prefix drift --validate-manifest

# --strict-manifest is --validate-manifest + rejects any EXTRA unknown
# top-level keys AND any value whose type doesn't match the schema
# (e.g., `combined` must be boolean, `matches` must be string[]). Use
# this in CI to catch drift in the emitter itself. Example failure:
#   INVALID drift-chromium.json [browser=chromium] — extra: unknownField \
#     | mistyped: combined (expected boolean, got string)
bun run schema-guard:view -- --manifest-dir reports/_ci --manifest-prefix drift --strict-manifest

# --require-valid runs validation FIRST and only proceeds to the diff/viewer
# output if it passes; any validation failure exits non-zero BEFORE any diff
# is printed. This is on by default in CI (SCHEMA_DRIFT_REQUIRE_VALID=1).
bun run schema-guard:view -- \
  --manifest-dir reports/_ci --manifest-prefix drift \
  --strict-manifest --require-valid
```

### `--validation-report` JSON structure

`--validation-report <path>` writes a machine-readable summary of every
`<prefix>-*.json` file the validator visited. Shape:

```jsonc
{
  "generatedAt": "2026-01-05T12:34:56Z",   // UTC, seconds precision
  "strict": true,                           // true when --strict-manifest was set
  "schemaPath": "schemas/schema-drift-manifest.schema.json",
  "totals": { "checked": 4, "ok": 3, "invalid": 1 },
  "files": [
    {
      "path": "reports/_ci/drift-chromium.json",
      "ok": false,
      "browser": "chromium",       // null if the manifest is unparseable
      "combined": false,           // true for the aggregate manifest
      "parseError": null,          // non-null string when JSON.parse failed
      "missing":  ["requiredArtifacts"],
      "mistyped": [
        { "key": "combined", "expected": "boolean", "got": "string" },
        { "key": "matches",  "expected": "string[]", "got": "number[]" }
      ],
      "extra":    ["unknownField"] // only populated under --strict-manifest
    }
  ]
}
```

CI consumes this file to emit `::error file=<path>::[browser=…] missing: …
| mistyped: … | extra: …` annotations directly into the run's annotations
pane. See `.github/workflows/ci.yml` → **schema-drift-view.sh validation
annotations** for the exact projection.

### Reproducing validator failures locally

Committed fixture manifests live under
[`scripts/fixtures/schema-drift-manifests/`](scripts/fixtures/schema-drift-manifests/README.md)
— one subdirectory per failure mode (`valid`, `missing-nested`,
`wrong-types`, `extra-keys`, `combined-mismatch`). Reproduce any CI
validation failure with a single command, no bundle required:

```sh
bash scripts/schema-drift-view.sh --strict-manifest \
  --manifest-dir scripts/fixtures/schema-drift-manifests/wrong-types \
  --manifest-prefix drift \
  --validation-report /tmp/report.json
```

The `combined-mismatch/` fixture exercises cross-file schema issues —
its `drift-combined.json` is missing the top-level `browser` key while
its per-browser sibling (`drift-webkit.json`) lists a browser that is
not present in the combined `browsers` array. Useful for reproducing
combined-vs-per-browser drift locally.

#### CI annotation caps (env vars)

The CI step that turns `--validation-report` JSON into
`::error::` / `::warning::` annotations and the PR-comment body reads
the following env vars (all integers, all defaulted):

| Variable                          | Default | Controls                                                     |
|-----------------------------------|---------|--------------------------------------------------------------|
| `SCHEMA_DRIFT_ANNOTATION_MAX`     | `10`    | Max failing manifests annotated / rendered in the PR comment |
| `SCHEMA_DRIFT_MISSING_CAP`        | `20`    | Max `missing:` keys listed per manifest                      |
| `SCHEMA_DRIFT_MISTYPED_CAP`       | `20`    | Max `mistyped:` entries listed per manifest                  |
| `SCHEMA_DRIFT_EXTRA_CAP`          | `20`    | Max `extra:` keys listed per manifest                        |

Overflow is summarized as `…+N more` in-line and — when whole manifests
are elided — a trailing `::warning::` pointing at the uploaded
`schema-drift-fixture-validation` artifact (which now always includes
`validation-report.json`, the generated `pr-comment.md`, and the
`annotations.txt` workflow-command file).

#### Local debug commands

Two thin CLIs read `validation-report.json` directly so you can
reproduce (and filter) the CI output without re-running the workflow:

| Script                                    | Output                                             |
|-------------------------------------------|----------------------------------------------------|
| `scripts/schema-drift-summary.ts`         | Concise terminal text (path + missing/mistyped/extra) |
| `scripts/schema-drift-pr-comment.ts`      | Markdown body identical to CI's `pr-comment.md`    |
| `scripts/schema-drift-debug.sh`           | Wrapper: runs both and prints the `pr-comment.md` path |

Both CLIs share the same filter + cap flags — pass them once and the
rendered rows / anchors / truncation match byte-for-byte:

| Flag                       | Effect                                                                                                                    |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------|
| `--browser <name>`         | Only include failures whose `browser` field equals `<name>` (e.g. `chromium`).                                            |
| `--path <substr>`          | Only include failures whose `path` contains `<substr>`.                                                                   |
| `--kind <k>`               | Only include failures exhibiting `<k>` (`missing` \| `mistyped` \| `extra` \| `parseError`). Repeatable.                  |
| `--max <n>`                | Cap the number of failure rows rendered (overrides `SCHEMA_DRIFT_ANNOTATION_MAX`).                                        |
| `--missing-cap <n>`        | Cap items in the per-row `missing:` list (overrides `SCHEMA_DRIFT_MISSING_CAP`). *pr-comment only.*                       |
| `--mistyped-cap <n>`       | Cap items in the per-row `mistyped:` list (overrides `SCHEMA_DRIFT_MISTYPED_CAP`). *pr-comment only.*                     |
| `--extra-cap <n>`          | Cap items in the per-row `extra:` list (overrides `SCHEMA_DRIFT_EXTRA_CAP`). *pr-comment only.*                           |
| `--out <path>`             | Write the Markdown body to `<path>` instead of stdout. *pr-comment only.*                                                 |
| `--annotations-file <path>`| Also write a workflow-commands file (one `::error::` line per selected row, each linking to `#fail-<slug>` in `pr-comment.md`). *pr-comment only.* |
| `--comment-url <url>`      | Base URL prepended to each anchor in `--annotations-file` (defaults to empty). *pr-comment only.*                         |

Examples:

```sh
# 1. Terminal summary of only chromium mistyped failures
bun scripts/schema-drift-summary.ts /tmp/report.json \
  --browser chromium --kind mistyped

# 2. Regenerate CI's PR-comment body offline (byte-identical)
bun scripts/schema-drift-pr-comment.ts /tmp/report.json \
  --out /tmp/pr-comment.md

# 3. Same, but scoped to combined manifests, capping lists at 5
bun scripts/schema-drift-pr-comment.ts /tmp/report.json \
  --path combined --max 5 --missing-cap 5 --mistyped-cap 5 --extra-cap 5

# 4. Emit a stand-alone GitHub Actions annotations file
bun scripts/schema-drift-pr-comment.ts /tmp/report.json \
  --out /tmp/pr-comment.md \
  --annotations-file /tmp/annotations.txt \
  --comment-url "https://github.com/OWNER/REPO/actions/runs/12345"

# 5. One-shot: terminal summary + generated pr-comment.md path
# 5. One-shot: terminal summary + generated pr-comment.md path
bash scripts/schema-drift-debug.sh /tmp/report.json \
  -- --browser webkit --kind missing

# 6. Preview selected failures + annotations without writing any file
bun scripts/schema-drift-pr-comment.ts /tmp/report.json --dry-run --max 3

# 7. Group terminal summary by browser with per-browser subtotals
bun scripts/schema-drift-summary.ts /tmp/report.json --group-by-browser

# 8. Diff two saved validation reports and write Markdown for a PR/issue
bun scripts/schema-drift-diff.ts /tmp/report-before.json /tmp/report-after.json \
  --browser chromium --kind missing --max 5 \
  --markdown --out /tmp/schema-drift-diff.md
```

Determinism: both CLIs sort failures by `(path ASC, browser ASC)` before
applying `--max`, so the identical top-N appear in the terminal summary,
`pr-comment.md`, and the CI job summary. `schema-drift-diff.ts`
re-computes anchors via the same `anchorFor()` helper, so a row that
appears in both reports keeps the same `#fail-<slug>` link regardless of
input order.

#### `schema-drift-diff.ts` output modes

Text (default), Markdown (`--markdown` or an `--out *.md` path), or JSON
(`--json`). `--dry-run` prints the body without writing `--out`.
`--fail-slug <slug>` limits both markdown and JSON output to specific
anchors (e.g. `--fail-slug fail-chromium-drift-chromium`); a leading `#`
is stripped. The flag is repeatable **and** accepts a comma-separated
list, so all of these are equivalent:

```bash
--fail-slug fail-a --fail-slug fail-b
--fail-slug fail-a,fail-b
--fail-slug='#fail-a,#fail-b'
```

`--fail-slug` and `--kind` also accept glob (`*`, `?`) and `/regex/flags`
patterns so a single flag can select a whole family of failures:

```bash
# all chromium failures, in one flag
schema-drift-diff before.json after.json --json --fail-slug 'fail-chromium-*'

# regex with flags — case-insensitive match on the anchor
schema-drift-diff before.json after.json --fail-slug '/^fail-(chromium|webkit)-/i'

# --kind expands `mis*` to both `missing` and `mistyped`
schema-drift-diff before.json after.json --kind 'mis*'

# combine: two globs, one CSV
schema-drift-diff before.json after.json --json \
  --fail-slug 'fail-chromium-*,fail-webkit-*' --kind 'parse*,extra'
```

The JSON Schema for the `--json` payload is published in-tree at
[`schemas/schema-drift-diff.schema.json`](schemas/schema-drift-diff.schema.json)
and can be printed to stdout for downstream tools without hard-coding a
path:

```bash
bun scripts/schema-drift-diff.ts --print-schema > diff.schema.json
```

Release notes for the diff CLI live in
[`CHANGELOG.md`](CHANGELOG.md) (see the `Unreleased` section for the
current `--json-out` atomic write, `--validate-json` payload shape, and
exit-code additions).

Metacharacters in glob patterns are escaped, so `--fail-slug 'fail.json'`
matches the literal `fail.json` (not `failXjson`); use `/regex/` when you
actually want regex semantics.

##### Writing / validating JSON output

`--json` prints to stdout; `--json-out <path>` writes the same bytes to
`<path>` (implies `--json`) and does so **atomically** — the tool writes
to a sibling `<path>.<pid>.tmp` and then `rename()`s it into place, so
readers never see a partial file. If the destination is not writable the
tool exits `7` with `cannot write json-out to "<path>": <errno>` and a
suggested `fix:` line.

`--validate-json` runs the resulting payload through Ajv against
[`schemas/schema-drift-diff.schema.json`](schemas/schema-drift-diff.schema.json)
before writing. On success it prints `validate-json: OK (<schema-path>)`
to stderr; on failure it exits `6` with a JSON error payload on stderr:

```json
{
  "error": "json-schema-mismatch",
  "code": 6,
  "schemaPath": "…/schemas/schema-drift-diff.schema.json",
  "message": "--json output does not match schema",
  "ajvErrors": [
    { "instancePath": "/totals", "schemaPath": "#/properties/totals/type",
      "keyword": "type", "message": "should be object", "params": { "type": "object" } }
  ],
  "expectedChecklist": [
    { "key": "totals",         "present": true  },
    { "key": "added",          "present": false },
    { "key": "removed",        "present": false },
    { "key": "changed",        "present": false },
    { "key": "matchedAnchors", "present": false }
  ],
  "fix": "regenerate the diff without --validate-json and inspect the JSON output"
}
```

Exit codes: `0` success, `2` bad CLI usage, `3` report file missing /
unreadable, `4` file is not valid JSON, `5` file is missing required
fields, `6` `--validate-json` schema mismatch, `7` `--json-out` / `--out`
destination not writable. Errors for exit codes `3–5` include a
suggested `fix:` line and, in text mode, an `[x] / [ ]` expected-schema
checklist; in `--json` mode the same context is emitted as a structured
JSON payload on stderr (fields: `error`, `code`, `path`, `problems`,
`receivedTopLevelKeys`, `missingTopLevelKeys`, `expectedChecklist`,
`expectedShape`, `fix`).

```json
{
  "totals": {
    "before": { "checked": 4, "invalid": 3 },
    "after":  { "checked": 4, "invalid": 2 },
    "added": 1, "removed": 2, "changed": 0, "matched": 1
  },
  "added":   [{ "path": "/a/drift-webkit.json",   "browser": "webkit",   "combined": false, "anchor": "fail-webkit-drift-webkit" }],
  "removed": [{ "path": "/a/drift-chromium.json", "browser": "chromium", "combined": false, "anchor": "fail-chromium-drift-chromium" }],
  "changed": [{
    "path": "/a/drift-combined.json", "browser": "combined", "combined": true,
    "anchor": "fail-combined-drift-combined",
    "missing":  { "added": ["browser"], "removed": [] },
    "extra":    { "added": [], "removed": ["stray"] },
    "mistyped": { "added": [], "removed": [] },
    "parseError": null
  }],
  "matchedAnchors": ["fail-combined-drift-combined"]
}
```





### CI expected artifact filenames (per browser)

The `e2e-live-region-verify` job enforces the following filenames under
`test-results/*<browser>*/` for each Playwright project (`chromium`,
`firefox`, `webkit`) — only enforced when that browser's `e2e` leg failed:

| Kind        | Expected filename            |
|-------------|------------------------------|
| Trace       | `live-region-trace.zip`      |
| Screenshot  | `live-region-failure.png`    |
| DOM dump    | `dom-snapshot.html`          |
| Live region | `live-region-log.json`, `live-region-innertext.txt` |

Missing required artifacts are echoed as `::warning::` (passing legs) or
`::error::` (failing legs) annotations that include the browser, the
expected filename, and the manifest entry that triggered the miss.

The CI **schema-guard** workflow additionally emits a per-browser
artifact manifest (expected filename → actual `test-results/` path,
with `✅ present` or `⚠️ missing`) into the job summary and echoes any
missing files as `::warning::` annotations so they surface in the run's
annotations pane. The same manifest is reproducible locally via
`--dry-run` — no CI artifact download required.

Drift diffs are always written to **`_schema_drift/`** in the repo root:

```
_schema_drift/
├── committed/                                 # snapshot of files pre-regen
├── regenerated/                               # what `schema:types` produced
├── focus-trap-inspect-report.schema.json.diff # unified diff (per file)
├── focus-trap-inspect-diff.schema.json.diff
├── focus-trap-inspect-schema.types.gen.ts.diff
├── check.log                                  # raw `schema:types:check` output
└── cli-schema-versions.txt                    # grep of SCHEMA_VERSION consts
```

The script restores your working tree before exiting, so a dry-run
never leaves regenerated files staged. Fix drift with `bun run
schema:types` and commit the regenerated files.

See [`docs/focus-trap-debug.md`](docs/focus-trap-debug.md) for the full
schema key reference and CLI flags.

## Reproducing the rapid-toggle live-region Playwright test locally

The rapid-toggle spec in
[`e2e/focus-trap-html-report-a11y.spec.ts`](e2e/focus-trap-html-report-a11y.spec.ts)
stresses the quarantine disclosure's `aria-live` region and asserts
"exactly one announcement per toggle" across Chromium / Firefox / WebKit.
To reproduce a CI failure locally:

```sh
# All three browsers, matches CI config
bun run test:e2e e2e/focus-trap-html-report-a11y.spec.ts

# Single browser, single spec, verbose
bunx playwright test e2e/focus-trap-html-report-a11y.spec.ts \
  --project=webkit -g "rapid-toggle" --reporter=list
```

### Attachment env vars

The spec attaches diagnostic files in a `finally` block. Two env vars
tune what gets captured (values: `1`/`true` = always attach, `0`/`false`
= never attach, unset/`auto` = attach only on failure):

| Env var | Controls | Default |
|---|---|---|
| `E2E_ATTACH_SCREENSHOT` | Full-page PNG of the failed state | `auto` |
| `E2E_ATTACH_TRACE` | Playwright `trace.zip` (screenshots + snapshots + sources) | `auto` |

```sh
# Force-attach everything, even on pass (local debugging)
E2E_ATTACH_SCREENSHOT=1 E2E_ATTACH_TRACE=1 \
  bunx playwright test e2e/focus-trap-html-report-a11y.spec.ts -g rapid-toggle

# Suppress heavy artifacts for a fast smoke run
E2E_ATTACH_SCREENSHOT=0 E2E_ATTACH_TRACE=0 \
  bunx playwright test e2e/focus-trap-html-report-a11y.spec.ts -g rapid-toggle
```

### Expected attachment filenames

Attachments land under `test-results/<test-id>/` locally and in the
`playwright-report` CI artifact:

| Filename | When | Contents |
|---|---|---|
| `live-region-log.json` | always | Ordered announcement log, `finalText`, `waitBudgetMs`, `observedWaitMs`, `browserName`, `attempt` |
| `live-region-innertext.txt` | always | Final `innerText` of the live region |
| `dom-snapshot.html` | always | Full `page.content()` at teardown |
| `live-region-failure.png` | on failure (or `E2E_ATTACH_SCREENSHOT=1`) | Full-page screenshot |
| `live-region-trace.zip` | on failure (or `E2E_ATTACH_TRACE=1`) | Playwright trace — open with `bunx playwright show-trace <path>` |

The spec also writes per-browser rows to `$GITHUB_STEP_SUMMARY` in CI
with a link to the run's Artifacts page for the trace/screenshot.

## pretty-index.json CI failure diagnostics

When the pretty-index.json check fails in CI (either matrix), each job
appends a "❌ pretty-index.json schema validation failed" block to
`$GITHUB_STEP_SUMMARY` followed by a "📎 pretty-index.json failure
diagnostics" block that links directly to an uploaded artifact:

| Matrix | Artifact name | Contents |
| --- | --- | --- |
| `atomic-crossos` | `schema-drift-diff-replay-pretty-index-failure-<os>` | `pretty-index.json`, `pretty-index.pre-check.json`, `pretty-index.report.json` |
| `nightly stress` | `schema-drift-diff-stress-replay-pretty-index-failure-<os>` | same three files |

`<os>` is one of `ubuntu-latest`, `macos-latest`, or `windows-latest`
(one artifact per matrix leg).

**Downloading a failure artifact** (`gh` CLI — replace `<run-id>` with the
failed CI run's ID from the Actions tab):

```sh
# atomic-crossos matrix (Linux leg shown; swap the -<os> suffix as needed)
gh run download <run-id> \
  -n schema-drift-diff-replay-pretty-index-failure-ubuntu-latest \
  -D ./_pretty-index-atomic
ls ./_pretty-index-atomic
#   pretty-index.json  pretty-index.pre-check.json  pretty-index.report.json

# nightly-stress matrix
gh run download <run-id> \
  -n schema-drift-diff-stress-replay-pretty-index-failure-ubuntu-latest \
  -D ./_pretty-index-stress
```

Or from the GitHub UI: open the failed run → scroll to the **Artifacts**
panel → click the artifact whose name matches the table above.

### Reproducing the failure locally against the downloaded artifacts

Once both `./_pretty-index-atomic/` and `./_pretty-index-stress/` are
populated, run the pre-commit hook in **validation mode** against them.
The single-command reproduction verifies sha256 checksums first, then
invokes the hook for both matrices in sequence:

```sh
# one-command reproduction (recommended)
make pretty-index-reproduce-downloaded

# cold-start: download BOTH artifacts, verify checksums, run the hook
make pretty-index-artifacts-download-verify-reproduce RUN_ID=<run-id> [OS=ubuntu-latest]

# verbose mode — prints resolved PRETTY_INDEX_HOOK_MATRIX, the on-disk
# diagnostics directory ($(INDEX)), the per-matrix downloaded dirs, and
# forwards PRETTY_INDEX_HOOK_VERBOSE=1 to the hook so each step prints
# its [exists]/[absent] candidate file list before exiting.
make pretty-index-reproduce-downloaded VERBOSE=1

# or step-by-step:
make pretty-index-artifacts-verify              # sha256sum -c both dirs (pass/fail summary + per-file hashes)
make pretty-index-hook-validate-downloaded      # runs the hook for atomic, then stress

# tidy up when you're done
make pretty-index-artifacts-clean               # removes ./_pretty-index-atomic and ./_pretty-index-stress
```


**Interpreting failures:**

`make` normalizes any failing recipe to exit code `2` — distinguish the
cases by the printed stdout signature, not by the numeric exit alone:

| stdout signature | Meaning | Fix |
| --- | --- | --- |
| `<file> expected=<hash> actual=<hash> [MISMATCH]` (also `<file>: FAILED` from `sha256sum`) | Corrupted / mutated bytes | Re-download the artifact (`make pretty-index-artifacts-download RUN_ID=...`) |
| `<file>: FAILED open or read` | A listed file is missing from the downloaded dir | Re-download; the upload was incomplete |
| `❌ ./_pretty-index-<matrix> missing` | The whole download directory is absent | Run `make pretty-index-artifacts-download RUN_ID=<id>` first |
| `❌ ./_pretty-index-<matrix>/pretty-index.checksums.sha256 missing` | Artifact was uploaded before CI computed checksums | Re-run the CI job on a commit that includes the checksum step |
| `❌ pre-commit: pretty-index CI check FAILED.` (from the hook) | Schema drift reproduced — see the printed `.report.json` for details | Fix the drift (regenerate + commit `pretty-index.json`) |
| `PRETTY_INDEX_HOOK_MATRIX must be atomic\|stress` | Invalid matrix env var | Only `atomic` or `stress` are accepted |

If verify fails, the hook step is **skipped entirely** — you will never
be asked to validate corrupted bytes. A machine-readable mismatch
report is written to `_pretty-index-checksum-mismatch.json` (override
with `PI_MISMATCH_REPORT=<path>`) so you can inspect the diff after
the fact. Run `.githooks/pre-commit --help` for the full documented
hook exit-code table (0/1/2/3/4).

**Scope (`PI_SCOPE`)** — every download-flow target accepts
`PI_SCOPE=atomic|stress|both` (default: `both`) to restrict the work:

```sh
make pretty-index-artifacts-verify           PI_SCOPE=atomic
make pretty-index-artifacts-verify-summary   PI_SCOPE=stress
make pretty-index-reproduce-downloaded       PI_SCOPE=atomic VERBOSE=1
make pretty-index-artifacts-download-verify-reproduce RUN_ID=<id> PI_SCOPE=stress
```

**Exit codes returned by each `pretty-index-*` make target:**

| Target | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `pretty-index-artifacts-verify` | all listed checksums match | at least one file mismatched or missing (writes `PI_MISMATCH_REPORT`) | dir missing / `.checksums.sha256` missing / bad `PI_SCOPE` |
| `pretty-index-artifacts-verify-summary` | all matrices `PASS` | any matrix `FAIL` | bad `PI_SCOPE` |
| `pretty-index-artifacts-download` | download succeeded | — | `RUN_ID` unset / `gh` not installed |
| `pretty-index-hook-validate-downloaded` | verify + hook both passed | verify failed **or** hook reported schema drift | dir / `pretty-index.json` / `PI_SCOPE` invalid |
| `pretty-index-reproduce-downloaded` | verify + hook both passed | verify failed **or** hook drift | same as above |
| `pretty-index-artifacts-download-verify-reproduce` | full pipeline passed | verify or hook failed | `RUN_ID` unset or same as above |
| `pretty-index-artifacts-clean` | always 0 | — | — |
| `pretty-index-hook-dry-run` | always 0 (hook prints paths only) | — | invalid `PRETTY_INDEX_HOOK_MATRIX` (from the hook, exit 2) |

Run `make pretty-index-help` for a concise on-terminal reference of
every target, override, and `VERBOSE=1` behavior.

**Fast feedback (`PI_FAIL_FAST=1`)** — abort the verify walk at the
first per-file `MISMATCH` (or missing dir / missing checksums file).
The generated report still parses as valid JSON and includes a
`"fail_fast": true` marker so consumers know the results array is
partial:

```sh
make pretty-index-artifacts-verify PI_FAIL_FAST=1
```

**Custom mismatch report path (`PI_REPORT_PATH`)** — by default the
verify targets write the machine-readable mismatch report to
`_pretty-index-checksum-mismatch.json` in the current directory. Point
it anywhere:

```sh
make pretty-index-artifacts-verify PI_REPORT_PATH=/tmp/pi-mismatch.json
make pretty-index-artifacts-verify PI_REPORT_PATH=reports/pi/mismatch.json
```

Parent directories are created automatically. The legacy variable
`PI_MISMATCH_REPORT` is still honored (used as the default value of
`PI_REPORT_PATH`).

### Checksum-mismatch report JSON format

The report is a single JSON object written **only when verification
fails**. On success, no file is written (any stale copy is removed
first). Uploaded from CI as
`pretty-index-checksum-mismatch-<matrix>-<os>` (retention 14 days).

**Top-level shape:**

| Field | Type | Description |
| --- | --- | --- |
| `schema` | string | Always `"pretty-index-checksum-mismatch/v1"`. |
| `scope` | `"atomic"` \| `"stress"` \| `"both"` | Value of `PI_SCOPE` used for the run (or the matrix name in CI). |
| `fail_fast` | boolean | `true` iff the walk was cut short by `PI_FAIL_FAST=1`. Only present in local Make output. |
| `matrix` | `"atomic"` \| `"stress"` | CI-only. Same as `scope` when the run is single-matrix. |
| `dir` | string | CI-only. The on-disk diagnostics directory verified. |
| `results` | array | One entry per file checked OR per error case (see below). Empty array = no files were reachable (all directories missing). |

**`results[]` entry shapes:**

Per-file result (the common case):

```json
{
  "dir": "./_pretty-index-atomic",
  "file": "pretty-index.report.json",
  "expected": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "actual":   "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "status":   "MISMATCH"
}
```

Error-case results (no `expected`/`actual` — the file couldn't be checked at all):

```json
{ "dir": "./_pretty-index-stress", "status": "dir_missing" }
{ "dir": "./_pretty-index-atomic", "status": "checksums_missing" }
```

**Status values:**

| `status` | Meaning |
| --- | --- |
| `MISMATCH` | Both hashes were computable but differ. `actual: ""` means the file listed in `pretty-index.checksums.sha256` no longer exists on disk. |
| `OK` | File verified; only surfaces alongside `MISMATCH` siblings in the same failed run (so consumers can see the full picture). |
| `dir_missing` | `_pretty-index-<matrix>/` was not present — user needs to run `make pretty-index-artifacts-download RUN_ID=<id>`. |
| `checksums_missing` | Directory exists but `pretty-index.checksums.sha256` was not uploaded with the artifact. |

**Complete example (local, `PI_SCOPE=both`, one file corrupted):**

```json
{
  "schema": "pretty-index-checksum-mismatch/v1",
  "scope": "both",
  "fail_fast": false,
  "results": [
    { "dir": "./_pretty-index-atomic", "file": "pretty-index.json",           "expected": "…", "actual": "…", "status": "OK" },
    { "dir": "./_pretty-index-atomic", "file": "pretty-index.pre-check.json", "expected": "…", "actual": "…", "status": "OK" },
    { "dir": "./_pretty-index-atomic", "file": "pretty-index.report.json",    "expected": "e3b0…b855", "actual": "9f86…0a08", "status": "MISMATCH" },
    { "dir": "./_pretty-index-stress", "status": "dir_missing" }
  ]
}
```

Parse with `jq`:

```sh
jq '[.results[] | select(.status=="MISMATCH")]' _pretty-index-checksum-mismatch.json
```

### Inspecting the mismatch report

Four targets read the JSON report at `$(PI_REPORT_PATH)` (default
`_pretty-index-checksum-mismatch.json`). All require `jq`.

```sh
# Per-matrix counts printed to stdout; exits 3 if any mismatches exist.
make pretty-index-mismatch-summary

# Same numbers, but written as a small JSON file for CI parsing.
# Always exits 0 on successful write.
make pretty-index-mismatch-summary-json
make pretty-index-mismatch-summary-json PI_SUMMARY_JSON_PATH=/tmp/pi-summary.json

# Export the mismatch report to CSV
# (columns: matrix,artifact_dir,path,expected_hash,actual_hash).
make pretty-index-mismatch-csv
make pretty-index-mismatch-csv PI_CSV_PATH=/tmp/pi-mismatch.csv

# Per-file table; PI_PATH_GLOB filters rows whose .path matches the pattern.
make pretty-index-mismatch-show
make pretty-index-mismatch-show PI_PATH_GLOB='.*report\.json$'

# Diff current report against a baseline; exits 4 if NEW/CHANGED entries appear.
make pretty-index-mismatch-diff PI_BASELINE=baseline.json
```

`pretty-index-mismatch-summary-json` shape (`schema:"pretty-index-mismatch-summary/v1"`):

```json
{
  "schema": "pretty-index-mismatch-summary/v1",
  "scope": "both",
  "matrices": {
    "atomic": { "total": 3, "mismatched": 1, "missing": 0 },
    "stress": { "total": 0, "mismatched": 0, "missing": 1 }
  },
  "totals": { "total": 4, "mismatched": 1, "missing": 1 }
}
```

**Exit codes for mismatch-inspection targets:**

| Target | 0 | Non-zero |
| --- | --- | --- |
| `pretty-index-mismatch-summary` | no mismatches AND no missing artifacts | `3` mismatches/missing present, `2` report file absent or `jq` missing |
| `pretty-index-mismatch-summary-json` | wrote summary JSON | `2` report file absent or `jq` missing |
| `pretty-index-mismatch-summary-validate` | summary matches schema (also `0` with deprecation warning when `schema` is `pretty-index-mismatch-summary/v0`) | `5` schema/shape violation, `2` file or tooling missing |
| `pretty-index-mismatch-summary-json-merge` | wrote merged summary (missing inputs are tolerated and recorded under `sources[].missing:true`) | `2` when `PI_SUMMARY_INPUTS` is empty or `jq` missing |
| `pretty-index-mismatch-csv` | wrote CSV file | `2` report file absent or `jq` missing |
| `pretty-index-mismatch-show` (± `PI_PATH_GLOB`) | printed table (may be empty after glob filter) | `2` report file absent or `jq` missing |
| `pretty-index-mismatch-diff` (± `PI_DIFF_OUT_PATH`) | current report matches baseline | `4` NEW/CHANGED entries found (diff report written to `PI_DIFF_OUT_PATH` when set), `2` either report absent or `jq` missing |
| `pretty-index-mismatch-ci` (± `PI_CI_BUNDLE_PATH`) | pipeline succeeded and no mismatches | `3` mismatches present (artifacts bundled to `PI_CI_BUNDLE_PATH`), `5` validation failed, `2` report/tooling missing |

Recipes emit `exit 3` / `exit 4` / `exit 5` intentionally; GNU make wraps any
failing recipe as its own exit status `2` and prints `make: *** [target]
Error N`, so scripts that need the granular code should parse `Error N`
from stderr (or invoke the recipe directly via `bash -c`).

### CI-parity pipeline (`pretty-index-mismatch-ci`)

Runs summary-json → validate (with `--report-json`) → summary-md → diff
end-to-end on a local mismatch report, mirroring what CI does. All
generated files are written into `PI_CI_OUT_DIR` (default
`./_pretty-index-ci/`): `summary.json`, `summary.md`, `validate-report.json`,
`validate-annotations.txt`, and (when `PI_BASELINE` points at a real
file) `diff.json`. If mismatches are present, everything is bundled into
`PI_CI_BUNDLE_PATH` (default `./_pretty-index-ci.tar.gz`) as a single
downloadable artifact and the target exits `3`.

```sh
make pretty-index-mismatch-ci \
  PI_REPORT_PATH=_pretty-index-checksum-mismatch.json \
  PI_BASELINE=baseline.json \
  PI_CI_BUNDLE_PATH=/tmp/pi-ci-bundle.tar.gz
```

Every run of `pretty-index-mismatch-ci` also asserts that the emitted
`validate-report.json` is well-formed — every documented v1 key must be
present with the expected type (`schema`/`status`/`file`/`summary_schema`/`note`
as `string`, `exit_code` as `number`, `errors` as `array`). If any key
is missing or has the wrong type the pipeline exits `5` with an
`ERROR: validate-report.json failed schema assertion` block listing
each offending key on its own line so CI logs are self-diagnosing.

#### Fresh-checkout selftest (`pretty-index-mismatch-ci-selftest-all`)

To confirm CI parity without needing a real replay run, use the
synthetic-fixture selftests. They generate a minimal
`pretty-index-checksum-mismatch/v1` report on the fly with `jq -n`,
run the full CI pipeline against it, and assert the tarball plus
`validate-report.json`, `validate-annotations.txt`, `summary.json`, and
`summary.md` are all produced.

```sh
# Run for a single scope (default: atomic)
make pretty-index-mismatch-ci-selftest
make pretty-index-mismatch-ci-selftest PI_CI_SELFTEST_SCOPE=stress

# Explicit per-scope invocations of the aggregate target (equivalent to
# what `pretty-index-mismatch-ci-selftest-all` runs internally)
make pretty-index-mismatch-ci-selftest-all PI_CI_SELFTEST_SCOPE=atomic
make pretty-index-mismatch-ci-selftest-all PI_CI_SELFTEST_SCOPE=stress

# Recommended fresh-checkout smoke test — runs BOTH scopes back-to-back
# into isolated scratch dirs (_pi-ci-selftest-atomic, _pi-ci-selftest-stress)
make pretty-index-mismatch-ci-selftest-all
```

Standalone strict-schema check for an arbitrary `validate-report.json`
(pre-commit hook, ad-hoc CI wiring — same jq assertion the pipeline
uses):

```sh
make pretty-index-validate-report-check \
  VALIDATE_REPORT_JSON=path/to/validate-report.json
# exit 0 = ok, 5 = schema assertion failed, 2 = tooling / missing file
```

Variables:

| Variable                 | Default                | Purpose                                                                                    |
|--------------------------|------------------------|--------------------------------------------------------------------------------------------|
| `PI_CI_SELFTEST_SCOPE`   | `atomic`               | Scope/matrix label written into the synthetic fixture (`atomic` or `stress`).              |
| `PI_CI_SELFTEST_DIR`     | `_pi-ci-selftest`      | Scratch directory. `-selftest-all` overrides to `_pi-ci-selftest-{atomic,stress}` per scope. |
| `VALIDATE_REPORT_JSON`   | _(required)_           | Input path for `pretty-index-validate-report-check`.                                       |

Expected artifacts under `$(PI_CI_SELFTEST_DIR)/`:

- `report.json` — synthesized mismatch input
- `out/summary.json`, `out/summary.md` — pipeline outputs
- `out/validate-report.json`, `out/validate-annotations.txt` — always present, even when empty
- `out/validate-schema-assertion.txt` — jq schema-assertion stderr (empty on pass)
- `bundle.tar.gz` — the exact tarball CI would upload


#### Where to find CI artifacts (atomic + stress)

Each `pretty-index-mismatch-ci` invocation writes artifacts to a scope-specific
path. The same layout is used locally and on GitHub Actions — only the
root differs.

| Scope    | Local (default)                 | CI (`PI_CI_OUT_DIR`)      | Bundle tarball (`PI_CI_BUNDLE_PATH`) |
|----------|---------------------------------|---------------------------|--------------------------------------|
| `atomic` | `_pretty-index-ci/`             | `/tmp/pi-ci-atomic/`      | `/tmp/pi-ci-atomic.tar.gz`           |
| `stress` | `_pretty-index-ci/`             | `/tmp/pi-ci-stress/`      | `/tmp/pi-ci-stress.tar.gz`           |

Inside each output directory (always present, even on early failure):

- `summary.json` / `summary.md` — aggregate mismatch summary
- `validate-report.json` — machine-readable validator report
- `validate-annotations.txt` — validator stderr annotations
- `validate-schema-assertion.txt` — jq schema-assertion stderr (empty on pass)
- `diff.json` — baseline diff (only when `PI_BASELINE` was set)

Retrieving artifacts from a failing GitHub Actions run:

1. Open the failing job's step summary. Two artifact links are rendered
   per scope:
   - `pretty-index-mismatch-ci-bundle-<scope>-<os>` — full tarball
   - `pretty-index-mismatch-ci-validator-<scope>-<os>` — just
     `validate-report.json` + `validate-schema-assertion.txt` (fastest
     path for triaging schema failures; no `tar -xzf` needed)

##### Exact click-path from the GitHub Actions UI (per matrix run)

Use this when you want to reproduce a specific matrix cell locally
without the `gh` CLI:

1. Open the failing PR/commit → **Checks** tab → click the **CI** run.
2. In the left-hand job list, click the job whose name ends with the
   matrix cell you care about, e.g.
   `pretty-index-mismatch-ci (atomic, ubuntu-latest)` or
   `pretty-index-mismatch-ci (stress, ubuntu-latest)`.
3. In that job's **Summary** page, scroll to the
   **pretty-index-mismatch-ci preflight status — `<scope>`** table to
   see the OK / MISSING / EMPTY status and absolute path for each of
   `validate-report.json` and `validate-schema-assertion.txt` without
   downloading anything.
4. Scroll to the top of the run page and open the **Artifacts** panel
   (right-hand column on the run summary, or the paperclip icon on
   mobile). Download the two entries for the failing cell:
   - `pretty-index-mismatch-ci-bundle-<scope>-<os>.zip` — contains
     `pi-ci-<scope>.tar.gz` (the full bundle)
   - `pretty-index-mismatch-ci-validator-files-<scope>-<os>.zip` —
      contains `validate-report.json`, `validate-schema-assertion.txt`,
      `extracted-tree.txt`, and `preflight-status.md` (the last two are
      always present, even when extraction crashed before writing the two
      validator files)
5. Unzip both, then reproduce locally:

   ```sh
   # Point the recheck target at the tarball (recommended path):
   make pretty-index-mismatch-ci-bundle-clean PI_CI_SCOPE=<scope>
   mkdir -p ./_pi-ci-bundle-<scope>/extracted/pi-ci-<scope>
   tar -xzf pi-ci-<scope>.tar.gz \
     -C ./_pi-ci-bundle-<scope>/extracted \
     --strip-components=0
   make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=<scope>
   ```

   Or, when you only downloaded the validator-files zip, drop the two
   files straight into
   `./_pi-ci-bundle-<scope>/extracted/pi-ci-<scope>/` and run the same
   `make pretty-index-mismatch-ci-bundle-recheck` command.

##### Exact artifact names & on-disk paths (failure upload + zip step)

Per matrix cell (`<scope>` ∈ {`atomic`, `stress`}, `<os>` ∈ CI runner OS,
typically `ubuntu-latest`), the CI failure path uploads these artifacts
with these exact names:

| Artifact (GitHub Actions name)                                            | Contents (unzipped)                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pretty-index-mismatch-ci-bundle-<scope>-<os>`                            | `pi-ci-<scope>.tar.gz` — the full bundle CI produced                                                                                                                       |
| `pretty-index-mismatch-ci-validator-files-<scope>-<os>`                   | `validate-report.json`, `validate-schema-assertion.txt`, `extracted-tree.txt`, `extracted-tree.json`, `preflight-status.md`, `preflight-status.json`                       |
| `pretty-index-mismatch-ci-report-schema-failure-<scope>-<os>` (schema-drift only) | `extracted-tree.json`, `preflight-status.json`, `report-schema-errors.txt` (jq/schema log), `report-schema-validation-log.txt` (full stdout+stderr of the validator, incl. `::error` line with expected/actual `schema_version`), `report-schema-validation-summary.json` (machine-readable per-file expected/actual + status + paths) — uploaded only when the schema validator exits non-zero |
| `pretty-index-mismatch-ci-report-schema-validation-log-<scope>-<os>` (always) | `report-schema-validation-log.txt` + `report-schema-validation-summary.json` — uploaded on **every** run (`if: always()`) so jq errors and per-file expected/actual `schema_version` are captured even when the step exits unexpectedly or times out. The log always starts with `pi-ci-validate-report-schemas: expected schema_version=<N>` and, on abnormal termination, adds a `terminated by <SIGNAL>` line. |

The schema-drift annotation on the failing step points at both the bad
JSON file and `report-schema-errors.txt`, and now includes expected +
actual `schema_version`, e.g.
`::error file=<abs>/extracted-tree.json::extracted-tree.json schema check failed (exit=5) — expected schema_version=1, actual=99 — see <abs>/report-schema-errors.txt — excerpt: …`.

The expected `schema_version` is configurable via the
`PI_CI_EXPECTED_SCHEMA_VERSION` environment variable (default `"1"`);
it is honored by both per-file schema checkers and reflected in the
annotation. Non-integer, empty, or whitespace-only values fail fast
with `ERROR: PI_CI_EXPECTED_SCHEMA_VERSION must be a non-empty integer`.

##### report-schema-validation-summary.json

Written by `scripts/ci/pi-ci-validate-report-schemas.sh` on every run
(schema `pi-ci/report-schema-validation-summary/v1`):

```json
{
  "schema": "pi-ci/report-schema-validation-summary/v1",
  "expected_schema_version": "1",
  "out_dir": "/tmp/pi-ci-atomic",
  "terminated_by": null,
  "files": [
    { "label": "extracted-tree.json",   "path": "…/extracted-tree.json",   "expected_schema_version": "1", "actual_schema_version": "99",              "status": "FAIL", "exit": 5, "reason": "schema-drift" },
    { "label": "preflight-status.json", "path": "…/preflight-status.json", "expected_schema_version": "1", "actual_schema_version": "1",               "status": "OK",   "exit": 0, "reason": "ok" }
  ],
  "exit": 5
}
```

Interpretation: match `files[].label` to the sidecar, compare
`expected_schema_version` vs `actual_schema_version`, and open
`files[].path` for the failing file. The `files[].reason` field is
machine-readable and takes one of these values:

| `reason`                    | Meaning |
|-----------------------------|---------|
| `ok`                        | File parsed and matched the expected schema |
| `missing-file`              | Sidecar path does not exist on disk (`actual_schema_version="<missing-file>"`) |
| `empty-file`                | Sidecar exists but is zero bytes (`actual_schema_version="<empty-file>"`) |
| `jq-missing`                | `jq` binary not available on this runner |
| `jq-parse-failed`           | `jq` could not parse the sidecar JSON (`actual_schema_version="<unreadable>"`) |
| `jq-timeout`                | `jq` was wrapped in `timeout(1)` (via `PI_CI_JQ_TIMEOUT_SECS`) and exited `124` (`actual_schema_version="<timeout>"`) |
| `schema_version-missing`    | JSON parsed but has no `schema_version` key (`actual_schema_version="<missing>"`) |
| `schema_version-empty`      | JSON parsed and `schema_version` is present as an empty string (`actual_schema_version=""`) |
| `schema_version-malformed`  | `schema_version` present but non-numeric (`actual_schema_version` preserves the exact received value, e.g. `"v2"`, `"1.0"`) |
| `schema-drift`              | Parsed value differs from `expected_schema_version` |

Top-level `reason` values only appear on early-exit paths:
`"bad-env-var"` (invalid `PI_CI_EXPECTED_SCHEMA_VERSION`, `exit: 2`,
empty `files` — the exact received value is preserved in
`expected_schema_version`) or `"terminated"` (`SIGTERM/INT/HUP`,
`terminated_by` records the signal, `exit: null`).

For `jq-parse-failed`, the failing file row also includes
`jq_stderr_excerpt` and `jq_stderr_path` when stderr was captured.

The summary also includes top-level `pi_ci_jq_bin`, `jq_bin`,
`jq_version`, `jq_cmdline` (the full command with any `timeout(1)`
prefix), and `jq_timeout_secs` — populated from `PI_CI_JQ_BIN` /
`PI_CI_JQ_TIMEOUT_SECS`. These are echoed into
`report-schema-validation-log.txt` as
`pi-ci-validate-report-schemas: PI_CI_JQ_BIN=…` / `jq_bin=…` /
`jq_version=…` / `jq_cmdline=…` / `jq_timeout_secs=…` so a
`jq-timeout` incident can be reproduced locally with the same binary
and wrapper.

Example — `schema-drift` diff context (per-file `diff` block +
inline `── <label> drift diff ──` echoed to the log):

```json
{
  "files": [
    { "label": "extracted-tree.json", "path": "…/extracted-tree.json",
      "expected_schema_version": "1", "actual_schema_version": "99",
      "status": "FAIL", "exit": 5, "reason": "schema-drift",
      "diff": { "schema_version": { "expected": "1", "actual": "99" } } }
  ]
}
```

```
── extracted-tree.json drift diff ──
  schema_version: expected=1  actual=99
```

Example — jq parse failure on both sidecars:

```json
{
  "schema": "pi-ci/report-schema-validation-summary/v1",
  "expected_schema_version": "1", "out_dir": "…", "terminated_by": null,
  "files": [
    { "label": "extracted-tree.json",   "path": "…/extracted-tree.json",   "actual_schema_version": "<unreadable>", "status": "FAIL", "reason": "jq-parse-failed", "exit": 0, "expected_schema_version": "1" },
    { "label": "preflight-status.json", "path": "…/preflight-status.json", "actual_schema_version": "<unreadable>", "status": "FAIL", "reason": "jq-parse-failed", "exit": 0, "expected_schema_version": "1" }
  ],
  "exit": 0
}
```

Example — both sidecars missing on disk:

```json
{
  "files": [
    { "label": "extracted-tree.json",   "path": "…/extracted-tree.json",   "actual_schema_version": "<missing-file>", "status": "FAIL", "reason": "missing-file", "exit": 2, "expected_schema_version": "1" },
    { "label": "preflight-status.json", "path": "…/preflight-status.json", "actual_schema_version": "<missing-file>", "status": "FAIL", "reason": "missing-file", "exit": 2, "expected_schema_version": "1" }
  ]
}
```

The same `reason` values are echoed in the validator's `── per-file
reasons ──` block in `report-schema-validation-log.txt` and inline in
each `::error` annotation (`reason=<value>`) so triagers can spot
parse/timeout/missing causes without opening the JSON.



##### schema-validate exit codes

`scripts/ci/pi-ci-validate-report-schemas.sh` prints an
`── schema-validate exit codes ──` block at the tail of its output
(mirrored into `report-schema-validation-log.txt`) with the same table:

| Exit | Meaning |
|------|---------|
| `0`  | Both `extracted-tree.json` and `preflight-status.json` match the schema |
| `2`  | Tooling missing (`jq`), invalid `PI_CI_EXPECTED_SCHEMA_VERSION`, or a required JSON sidecar is missing/empty |
| `5`  | Schema violation — includes `schema_version` mismatch against the configured expected value |

`content_hash` drift between the shareable zip and on-disk sidecars is
reported separately by `make pretty-index-mismatch-ci-bundle-zip-verify`
with exit `3` (make wraps this as its own `Error 3`).




After you download & unpack a `bundle-<scope>-<os>` artifact into
`./_pi-ci-bundle-<scope>/extracted/pi-ci-<scope>/`, the local zip step
(`make pretty-index-mismatch-ci-bundle-zip PI_CI_SCOPE=<scope>`) writes:

- `./_pi-ci-bundle-<scope>/pretty-index-mismatch-ci-bundle-<scope>-share.zip`
  — a single shareable archive containing every file from the bundle
  plus the regenerated sidecars
  `extracted-tree.txt`, `extracted-tree.json`, `preflight-status.md`,
  and `preflight-status.json`.

Before uploading/sharing that zip, verify it is a faithful snapshot:

```sh
make pretty-index-mismatch-ci-bundle-zip-verify                 # atomic
make pretty-index-mismatch-ci-bundle-zip-verify PI_CI_SCOPE=stress
```

The target unzips the archive to a scratch dir and confirms that
`extracted-tree.json` and `preflight-status.json` are both present AND
that their `content_hash` values match the on-disk sidecars under
`./_pi-ci-bundle-<scope>/extracted/pi-ci-<scope>/`. Exit codes: `0` on
match, `3` on hash drift (make wraps this as its own `Error 3`), `2` on
missing files/tools. On drift, the target also prints a short diff of
the `.schema`, `.schema_version`, and `.content_hash` fields between the
zipped and on-disk sidecars so you can see what changed without
unzipping.

##### Local schema validation against an already-downloaded artifact

Regenerate both sidecars and run the extracted-tree + preflight schema
checkers in one command — no `gh` download required:

```sh
make pretty-index-mismatch-ci-bundle-validate-reports-dir \
  DIR=./_pi-ci-bundle-atomic/extracted/pi-ci-atomic \
  PI_CI_SCOPE=atomic
```

Prints the preflight status table, the paths to
`extracted-tree.{txt,json}` and `preflight-status.{md,json}` under
`DIR`, and finally runs
`scripts/ci/pi-ci-validate-report-schemas.sh`. Exit codes match the
validator: `0` OK, `2` tooling/missing input, `5` schema violation
(e.g. wrong `schema_version`).




2. Download the tarball (`pi-ci-<scope>.tar.gz`) and verify locally:

   ```sh
   make pretty-index-ci-tarball-verify \
     PI_CI_TARBALL=./pi-ci-atomic.tar.gz \
     PI_CI_TARBALL_ROOT=pi-ci-atomic   # matches PI_CI_OUT_DIR basename
   ```

   Exits `0` if both required files are present and the report matches the
   v1 schema, `2` for missing entries, `5` for schema-assertion failures.

#### One-shot download + extract (`pretty-index-mismatch-ci-bundle-download`)

Prefer this over clicking through the Actions UI when you just want the
extracted `validate-report.json` + `validate-schema-assertion.txt` on
disk. Requires an authenticated [`gh`](https://cli.github.com) CLI.

```sh
# Minimum (atomic on ubuntu-latest — the two defaults):
make pretty-index-mismatch-ci-bundle-download RUN_ID=1234567890

# Stress matrix:
make pretty-index-mismatch-ci-bundle-download RUN_ID=1234567890 PI_CI_SCOPE=stress

# Windows or macOS runner:
make pretty-index-mismatch-ci-bundle-download RUN_ID=1234567890 \
  PI_CI_SCOPE=atomic OS=windows-latest
```

| Variable        | Required | Default          | Notes                                    |
|-----------------|----------|------------------|------------------------------------------|
| `RUN_ID`        | yes      | —                | GitHub Actions run id                    |
| `PI_CI_SCOPE`   | no       | `atomic`         | `atomic` or `stress`                     |
| `OS`            | no       | `ubuntu-latest`  | matches the matrix `os` value            |

The target downloads artifact
`pretty-index-mismatch-ci-bundle-<scope>-<os>` and lands files under:

```
./_pi-ci-bundle-<scope>/
  pi-ci-<scope>.tar.gz            # the uploaded tarball
  extracted/
    pi-ci-<scope>/
      validate-report.json        # verified to exist — fails hard otherwise
      validate-schema-assertion.txt
      summary.json  summary.md  …
```

After extraction it re-verifies the two required files exist and prints a
`make pretty-index-ci-tarball-verify …` command tailored to the download
so you can immediately re-run the strict schema check locally.

#### One-shot local report (`pretty-index-mismatch-ci-bundle-report.sh`)

When you want the same two debug files CI uploads without manually
running separate Make targets, use:

```sh
# Download atomic/ubuntu-latest, then write preflight-status.md + extracted-tree.txt
scripts/pretty-index-mismatch-ci-bundle-report.sh 1234567890

# Stress or another runner OS:
scripts/pretty-index-mismatch-ci-bundle-report.sh 1234567890 stress
scripts/pretty-index-mismatch-ci-bundle-report.sh 1234567890 atomic macos-latest
```

It downloads and extracts `pretty-index-mismatch-ci-bundle-<scope>-<os>`
to `./_pi-ci-bundle-<scope>/extracted/pi-ci-<scope>/`, then writes:

- `preflight-status.md` — the same OK / MISSING / EMPTY Markdown table
  appended to the GitHub Actions job summary.
- `extracted-tree.txt` — the same size/path manifest uploaded by CI.

If the download or extraction step fails, the script still writes both
report files against the expected local directory before returning the
original download exit code.

#### Re-check locally without re-downloading (`pretty-index-mismatch-ci-bundle-recheck`)

Iterate on validator failures without hitting the `gh` CLI / network
again. Runs `pretty-index-validate-report-check` against the
already-extracted `validate-report.json` under
`./_pi-ci-bundle-<scope>/extracted/…`.

```sh
# Atomic failure (default scope):
make pretty-index-mismatch-ci-bundle-recheck

# Stress failure:
make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=stress
```

Fails with a pointer to `pretty-index-mismatch-ci-bundle-download` when
no extracted bundle is present.

#### Clean the extracted bundle (`pretty-index-mismatch-ci-bundle-clean`)

Wipe `./_pi-ci-bundle-<scope>/` so the next `…-bundle-download` (or
`…-bundle-recheck` after a fresh download) starts clean:

```sh
make pretty-index-mismatch-ci-bundle-clean                  # atomic
make pretty-index-mismatch-ci-bundle-clean PI_CI_SCOPE=stress
```

#### Where files land locally

Both `pretty-index-mismatch-ci-bundle-download` and
`pretty-index-mismatch-ci-bundle-clean` operate on the same
scope-specific directory rooted at the repo root:

| Scope    | Local extraction directory (removed by `…-clean`)                | Extracted validator files                                                                                       |
|----------|------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `atomic` | `./_pi-ci-bundle-atomic/` (tarball + `extracted/pi-ci-atomic/`)  | `./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-report.json` <br> `…/validate-schema-assertion.txt`     |
| `stress` | `./_pi-ci-bundle-stress/` (tarball + `extracted/pi-ci-stress/`)  | `./_pi-ci-bundle-stress/extracted/pi-ci-stress/validate-report.json` <br> `…/validate-schema-assertion.txt`     |

`pretty-index-mismatch-ci-bundle-recheck` reads from the exact same
paths, and its preflight fails fast if either
`validate-report.json` or `validate-schema-assertion.txt` is missing or
empty in the extracted directory above. It also prints the extracted
bundle listing (file name + byte size) via
`pretty-index-mismatch-ci-bundle-list` before running the check so you
can see exactly what it will consume:

```sh
make pretty-index-mismatch-ci-bundle-list                  # atomic
make pretty-index-mismatch-ci-bundle-list PI_CI_SCOPE=stress
```

#### One-command local report (`pretty-index-mismatch-ci-bundle-report`)

Download the bundle **and** print both the preflight status table and
the extracted-tree manifest paths in a single command:

```sh
make pretty-index-mismatch-ci-bundle-report RUN_ID=1234567890
make pretty-index-mismatch-ci-bundle-report RUN_ID=1234567890 PI_CI_SCOPE=stress
```

Already downloaded? Re-print the reports without hitting the network
(regenerates `preflight-status.md` + `extracted-tree.txt`/`.json`):

```sh
make pretty-index-mismatch-ci-bundle-report-show                   # atomic
make pretty-index-mismatch-ci-bundle-report-show PI_CI_SCOPE=stress
```

Schema/format-check the JSON manifest (the same check the E2E tests run):

```sh
make pretty-index-mismatch-ci-bundle-manifest-check                # atomic
```

Both `preflight-status.json` and `extracted-tree.json` include a
`content_hash` field so CI (and you) can diff runs that share the same
inputs and detect when artifacts silently changed.

#### Troubleshooting preflight failures — MISSING vs EMPTY decision tree

The preflight and reporting layers emit two distinct annotations for
each of `validate-report.json` and `validate-schema-assertion.txt`.
Interpret them with:

```
preflight annotation
├── MISSING  → file was never written by the CI producer
│       Look at: the *producing* job's logs BEFORE the artifact upload
│       step. Extracted-tree manifest (`extracted-tree.txt`) will list
│       every file that DID land — the missing one confirms it.
│       Fix locally: reproduce the producing step
│         (`make pretty-index-mismatch-ci`) and confirm it writes the
│         file into `$PI_CI_OUT_DIR`.
│
└── EMPTY    → file was written but is zero-bytes
        Look at: the producing step's stderr for a truncated write /
        early crash. `extracted-tree.txt` will show the file with
        `SIZE(B)=0`. `preflight-status.json.content_hash` will differ
        from a healthy run even though filenames match.
        Fix locally: re-run the producing step with
          `PI_FAIL_FAST=0` and inspect stderr for the failing writer.
```

Where to look in the uploaded artifacts:

| Annotation                         | Artifact file to open first                                    | What to check                                                          |
|-----------------------------------|----------------------------------------------------------------|------------------------------------------------------------------------|
| `MISSING validate-report.json`    | `extracted-tree.txt` / `.json`                                 | file absent from `entries[]` → producer never wrote it                 |
| `EMPTY   validate-report.json`    | `extracted-tree.txt` / `.json`                                 | entry present with `size: 0` → producer crashed mid-write              |
| `MISSING validate-schema-assertion.txt` | `preflight-status.md`                                    | table row shows `MISSING`; producer job log is the source of truth     |
| `EMPTY   validate-schema-assertion.txt` | `preflight-status.json` (`content_hash` diff vs healthy run) | zero-byte write; usually a swallowed non-zero exit in the assert step  |

#### Troubleshooting preflight failures


The preflight in `pretty-index-mismatch-ci-bundle-recheck` prints one
line per problem to stderr and exits `2`. Common cases:

| Message                                                                                   | Meaning                                                       | Fix                                                                                       |
|-------------------------------------------------------------------------------------------|---------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| `ERROR: no extracted bundle at ./_pi-ci-bundle-<scope>/extracted`                         | You never ran the downloader (or ran `…-bundle-clean` after). | `make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=<scope>`           |
| `ERROR: preflight: validate-report.json MISSING under …/extracted`                        | Tarball produced by CI did not contain `validate-report.json`.| Re-download the bundle; if it is still missing, the CI job aborted before writing it — inspect the `pretty-index-mismatch-ci-validator-files-<scope>-<os>` artifact's `extracted-tree.txt` for what actually got uploaded. |
| `ERROR: preflight: validate-report.json EMPTY at …/validate-report.json`                  | File exists but is zero-length.                               | Delete the local bundle (`make pretty-index-mismatch-ci-bundle-clean PI_CI_SCOPE=<scope>`) and re-download; if it repeats, the CI validator crashed before writing content. |
| `ERROR: preflight: validate-schema-assertion.txt MISSING under …/extracted`               | Tarball did not include the schema-assertion companion file.  | Same as above — re-download; consult the CI artifact's `extracted-tree.txt` if it stays missing. |
| `ERROR: preflight: validate-schema-assertion.txt EMPTY at …/validate-schema-assertion.txt`| Schema-assertion file present but zero-length.                | Clean and re-download; if it repeats, the CI step short-circuited before writing the jq output. |

All five cases exit `2`; the last line printed to stderr is always the
`hint:` re-download command. When running under `GITHUB_ACTIONS=true`,
each error is also emitted as a `::error file=<path>::` annotation so
it renders as a red inline annotation on the Actions job page.

#### Reproducing each preflight failure locally

Every failure mode can be reproduced against a hand-staged extracted
directory (no `gh` CLI / network needed). All paths assume
`PI_CI_SCOPE=atomic` (swap in `stress` and `pi-ci-stress` for the
stress matrix); the recheck command is the same every time:

```sh
EX=./_pi-ci-bundle-atomic/extracted/pi-ci-atomic

# reset
make pretty-index-mismatch-ci-bundle-clean PI_CI_SCOPE=atomic
mkdir -p "$EX"

# 1) validate-report.json MISSING
printf 'noop\n' > "$EX/validate-schema-assertion.txt"
make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=atomic  # exit 2

# 2) validate-report.json EMPTY
: > "$EX/validate-report.json"
make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=atomic  # exit 2

# 3) validate-schema-assertion.txt MISSING
rm -f "$EX/validate-schema-assertion.txt"
printf '{}\n' > "$EX/validate-report.json"
make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=atomic  # exit 2

# 4) validate-schema-assertion.txt EMPTY
: > "$EX/validate-schema-assertion.txt"
make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=atomic  # exit 2

# 5) no extracted directory at all
make pretty-index-mismatch-ci-bundle-clean PI_CI_SCOPE=atomic
make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=atomic  # exit 2
```

Each command prints the exact stderr messages listed in the
troubleshooting table above (also covered by
`scripts/__tests__/pretty-index-mismatch-ci-bundle-recheck-preflight.test.ts`).

#### One-shot download → list → recheck

For the common triage flow, `scripts/pretty-index-mismatch-ci-bundle-oneshot.sh`
chains all three targets:

```sh
scripts/pretty-index-mismatch-ci-bundle-oneshot.sh 1234567890                  # atomic
scripts/pretty-index-mismatch-ci-bundle-oneshot.sh 1234567890 stress           # stress
scripts/pretty-index-mismatch-ci-bundle-oneshot.sh 1234567890 atomic macos-latest
```

#### CI artifact & manifest paths (canonical reference)

The failure-upload paths are identical across every OS and both
matrices — only `<scope>` (`atomic` \| `stress`) and `<os>`
(`ubuntu-latest` \| `macos-latest` \| `windows-latest`) vary. Use this
table when triaging a failed run:

| Artifact name (GitHub Actions)                                                | Contents / upload cadence                                                                                                                                             | On-runner path (before upload)                                                                                                          |
|-------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `pretty-index-mismatch-ci-bundle-<scope>-<os>`                                | Full `pi-ci-<scope>.tar.gz` bundle (validator files + inputs).                                                                                                        | `/tmp/pi-ci-<scope>.tar.gz`                                                                                                             |
| `pretty-index-mismatch-ci-validator-files-<scope>-<os>`                       | Failure bundle with `validate-report.json`, `validate-schema-assertion.txt`, `extracted-tree.txt`, `preflight-status.md`.                                               | `/tmp/pi-ci-<scope>/validate-report.json` <br> `/tmp/pi-ci-<scope>/validate-schema-assertion.txt` <br> `/tmp/pi-ci-<scope>/extracted-tree.txt` <br> `/tmp/pi-ci-<scope>/preflight-status.md` |
| `pretty-index-mismatch-ci-extracted-tree-<scope>-<os>`                        | Standalone extracted-tree manifest, uploaded on every run.                                                                                                             | `/tmp/pi-ci-<scope>/extracted-tree.txt`                                                                                                 |
| `pretty-index-mismatch-ci-preflight-status-<scope>-<os>`                      | Standalone preflight status Markdown table, uploaded on every run.                                                                                                    | `/tmp/pi-ci-<scope>/preflight-status.md`                                                                                                |

The `extracted-tree.txt` manifest is a plain `<size-bytes>\t<path>`
listing (one file per line, sorted, paths relative to
`/tmp/pi-ci-<scope>`) prefixed with three `#`-comment lines giving the
source directory, the generation timestamp (UTC) and the row format.
Its presence is invariant: even when the pre-flight walk fails or the
directory itself does not exist, the file is created (possibly empty
after the header) so the upload payload never varies by OS or matrix.
`preflight-status.md` uses the same Markdown table as the job summary and
is also invariant; under `GITHUB_ACTIONS=true`, each non-OK row is echoed
as a `::error file=<path>::preflight: …` annotation in the step log.









### Machine-readable validator report (`--report-json`)

Set `PI_VALIDATE_REPORT_JSON=<path>` on `pretty-index-mismatch-summary-validate`
to write a `pretty-index-mismatch-summary-validate/v1` report file
alongside the human-readable stderr output. Useful for CI artifact
upload and downstream tooling:

```json
{
  "schema": "pretty-index-mismatch-summary-validate/v1",
  "status": "invalid",
  "exit_code": 5,
  "file": "summary.json",
  "summary_schema": "pretty-index-mismatch-summary/v1",
  "note": "shape validation failed",
  "errors": ["  - path=.matrices.atomic.total  problem=invalid_or_missing  value=-1"]
}
```

`status` is one of `ok`, `deprecated`, `invalid`, `missing`, `tooling`.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `make: *** Error 3` from `pretty-index-mismatch-summary` / `-ci` | Mismatches or missing artifacts present in the report | Inspect with `pretty-index-mismatch-show`; download bundle written to `PI_CI_BUNDLE_PATH` |
| `make: *** Error 4` from `pretty-index-mismatch-diff` | NEW/CHANGED entries vs baseline | Review `diff.json` (`PI_DIFF_OUT_PATH`); refresh baseline if intended |
| `make: *** Error 5` from `pretty-index-mismatch-summary-validate` | Summary JSON doesn't match schema | Check `validate-report.json` (`PI_VALIDATE_REPORT_JSON`) `errors[]` for exact JSON paths; regenerate with `pretty-index-mismatch-summary-json` |
| `make: *** Error 2` | Missing input file, missing `jq`/`ajv`, or empty `PI_SUMMARY_INPUTS` | Verify paths exist and required tools are installed |
| `warn: DEPRECATED: schema 'pretty-index-mismatch-summary/v0'` (exit `0`) | Legacy `v0` summary consumed by validator | Regenerate with `make pretty-index-mismatch-summary-json` to produce `v1`; drop any hand-maintained `v0` fixtures |
| `warn: missing input (treated as zero counts)` from merge | One of `PI_SUMMARY_INPUTS` doesn't exist (e.g. matrix job uploaded nothing) | Expected when a matrix had zero mismatches; the merged JSON records `sources[].missing:true` |

**v0 → v1 upgrade.** The only difference required by the schema is
`schema: "pretty-index-mismatch-summary/v1"` plus fully-populated
`matrices.{atomic,stress}` and `totals` count blocks. Re-running
`make pretty-index-mismatch-summary-json` against the current mismatch
report always produces a valid `v1` document — do not hand-edit.

### Schema for `summary.json`

Both `pretty-index-mismatch-summary-json` and `pretty-index-mismatch-summary-json-merge`
outputs conform to [`schemas/pretty-index-mismatch-summary-json.schema.json`](schemas/pretty-index-mismatch-summary-json.schema.json).
Wire it into your editor with a `$schema` comment or a JSON-Schema
mapping so autocomplete + inline validation "just work". Validate in CI
or locally with:

```sh
make pretty-index-mismatch-summary-validate \
  PI_SUMMARY_JSON_PATH=pi-mismatch-summary.merged.json
```

The target uses `ajv` when available and falls back to a `jq`-based
structural check on `schema`, `matrices.{atomic,stress}`, and `totals`.
Under GitHub Actions (`GITHUB_ACTIONS=true`), every failing path is also
emitted as a `::error file=<summary>::` annotation so the failing field
is highlighted in the run's "Annotations" panel before the recipe exits
with status `5`.

**Multi-version support.** `pretty-index-mismatch-summary/v0` (the
legacy shape) is still accepted for backward compatibility; the
validator exits `0` but prints a `warn:` line (and a `::warning::` GHA
annotation) instructing you to regenerate the summary so it upgrades to
`pretty-index-mismatch-summary/v1`.

### Diff report artifact

Set `PI_DIFF_OUT_PATH` when running `pretty-index-mismatch-diff` to
write the NEW/CHANGED entries into a machine-readable JSON
(`pretty-index-mismatch-diff/v1`) alongside the human-readable stdout.
In CI, upload that file and link its `artifact-url` in
`$GITHUB_STEP_SUMMARY` whenever the recipe exits `4`:

```yaml
- name: pretty-index diff vs baseline
  id: pi-diff
  continue-on-error: true
  run: |
    make -s pretty-index-mismatch-diff \
      PI_BASELINE=baseline.json \
      PI_REPORT_PATH=_pretty-index-checksum-mismatch.json \
      PI_DIFF_OUT_PATH=/tmp/pi-mismatch-diff.json
- name: upload diff report
  if: hashFiles('/tmp/pi-mismatch-diff.json') != ''
  id: upload-pi-diff
  uses: actions/upload-artifact@v4
  with: { name: pretty-index-mismatch-diff, path: /tmp/pi-mismatch-diff.json }
- name: link diff report in step summary
  if: steps.pi-diff.outcome == 'failure'
  run: |
    echo "- [download pretty-index-mismatch-diff.json](${{ steps.upload-pi-diff.outputs.artifact-url }})" >> "$GITHUB_STEP_SUMMARY"
```

### Merging per-matrix summary JSONs across CI jobs

When each matrix job (atomic, stress, per-OS) uploads its own
`pretty-index-mismatch-summary-<matrix>-<os>.json`, a downstream job can
consolidate them into one file:

```sh
make pretty-index-mismatch-summary-json-merge \
  PI_SUMMARY_INPUTS="downloaded/*/pi-mismatch-summary-*.json" \
  PI_SUMMARY_MERGED_PATH=pi-mismatch-summary.merged.json
```

Output schema: `pretty-index-mismatch-summary-merged/v1`. Per-matrix
`total/mismatched/missing` counters are summed element-wise; each input
is preserved under `sources[]` alongside its original `scope`. Missing
inputs (e.g. a matrix that had zero mismatches and therefore uploaded
no summary artifact) are tolerated: they emit a `warn:` line on stderr,
appear in `sources[]` with `"missing": true` and zeroed totals, and the
merged JSON is still produced and still passes
`pretty-index-mismatch-summary-validate`.

### Copy-pastable GitHub Actions workflow

Runs verify → summary → CSV, uploads both the raw mismatch report and
the machine-readable summary as artifacts, and surfaces the granular
recipe exit code (parsed from `make: *** Error N`) as the job's exit
status. Drop this into `.github/workflows/pretty-index-check.yml`:

```yaml
name: pretty-index checksum check
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        scope: [atomic, stress]
    steps:
      - uses: actions/checkout@v4
      - name: install jq
        run: sudo apt-get update && sudo apt-get install -y jq
      - name: download pretty-index artifacts
        run: make pretty-index-artifacts-download RUN_ID=${{ github.run_id }}
      - name: verify checksums
        id: verify
        continue-on-error: true
        run: |
          set +e
          make pretty-index-artifacts-verify \
            PI_SCOPE=${{ matrix.scope }} \
            PI_REPORT_PATH=/tmp/pi-mismatch-${{ matrix.scope }}.json \
              2> /tmp/verify.stderr
          rc=$?
          cat /tmp/verify.stderr >&2
          # GNU make normalizes to 2; recover the intended recipe code.
          real=$(grep -oE 'Error [0-9]+' /tmp/verify.stderr | tail -n1 | awk '{print $2}')
          echo "exit_code=${real:-$rc}" >> "$GITHUB_OUTPUT"
          exit $rc
      - name: build mismatch summary JSON
        if: steps.verify.outcome == 'failure'
        run: |
          make pretty-index-mismatch-summary-json \
            PI_REPORT_PATH=/tmp/pi-mismatch-${{ matrix.scope }}.json \
            PI_SUMMARY_JSON_PATH=/tmp/pi-summary-${{ matrix.scope }}.json
          make pretty-index-mismatch-csv \
            PI_REPORT_PATH=/tmp/pi-mismatch-${{ matrix.scope }}.json \
            PI_CSV_PATH=/tmp/pi-mismatch-${{ matrix.scope }}.csv
      - name: upload mismatch report + summary + csv
        if: steps.verify.outcome == 'failure'
        uses: actions/upload-artifact@v4
        with:
          name: pretty-index-mismatch-${{ matrix.scope }}
          path: |
            /tmp/pi-mismatch-${{ matrix.scope }}.json
            /tmp/pi-summary-${{ matrix.scope }}.json
            /tmp/pi-mismatch-${{ matrix.scope }}.csv
          if-no-files-found: error
          retention-days: 14
      - name: fail with granular recipe exit code
        if: steps.verify.outcome == 'failure'
        run: exit ${{ steps.verify.outputs.exit_code }}

  merge-summaries:
    needs: verify
    if: always() && needs.verify.result == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y jq
      - uses: actions/download-artifact@v4
        with: { path: _downloaded, pattern: pretty-index-mismatch-* }
      - name: merge per-scope summaries
        run: |
          make pretty-index-mismatch-summary-json-merge \
            PI_SUMMARY_INPUTS="$(ls _downloaded/*/pi-summary-*.json | xargs)" \
            PI_SUMMARY_MERGED_PATH=/tmp/pi-summary.merged.json
      - uses: actions/upload-artifact@v4
        with:
          name: pretty-index-mismatch-summary-merged
          path: /tmp/pi-summary.merged.json
          if-no-files-found: error
          retention-days: 14
```










**Where the diagnostic files are written on disk** (both matrices write
to the same directory — only the uploaded artifact *name* differs):

| Matrix | Directory | Files |
| --- | --- | --- |
| `atomic-crossos` (`MATRIX=atomic`) | `artifacts/schema-drift-diff-replay-verify/pretty/` | `pretty-index.json`, `pretty-index.pre-check.json`, `pretty-index.report.json` |
| `nightly stress` (`MATRIX=stress`) | `artifacts/schema-drift-diff-replay-verify/pretty/` | same three files, uploaded under the `stress-replay-...` artifact name |

Override the directory via `INDEX=path/to/pretty-index.json` — the
`.pre-check.json` / `.report.json` siblings are always written next to
the input file.


Each file's role:

- `pretty-index.json` — post-`--auto-migrate` index the validator saw
- `pretty-index.pre-check.json` — raw generator output **before** any
  auto-migration (compare against `pretty-index.json` to spot migration
  changes)
- `pretty-index.report.json` — validator `--report` machine-readable
  errors (`problems[]` with `path`, `expected`, `actual`, `message`)

To reproduce the exact same check locally before pushing:

```sh
# 1. Makefile target (defaults to the CI matrix path + atomic matrix)
make pretty-index-check
make pretty-index-check INDEX=path/to/pretty-index.json
make pretty-index-check MATRIX=stress          # nightly-stress artifact naming
make pretty-index-check-clean                  # discard prior diagnostics first
make pretty-index-check-pwsh MATRIX=stress     # route through PowerShell (Windows)
make pretty-index-diagnostics                  # print artifact paths only
make pretty-index-clean                        # rm .pre-check.json / .report.json

# 2. Bash reproduce script (macOS / Linux / WSL)
scripts/reproduce-ci-pretty-index-check.sh
scripts/reproduce-ci-pretty-index-check.sh --clean path/to/pretty-index.json
scripts/reproduce-ci-pretty-index-check.sh --matrix atomic    # (default)
scripts/reproduce-ci-pretty-index-check.sh --matrix stress    # nightly-stress naming

# 3. PowerShell reproduce script (Windows)
pwsh scripts/reproduce-ci-pretty-index-check.ps1
pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Clean path\to\pretty-index.json
pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Matrix atomic   # (default)
pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Matrix stress
```

`MATRIX` / `--matrix` / `-Matrix` (default `atomic`) controls which CI job
the diagnostic step-summary block claims the failure artifact belongs to.
Same input file + same exit code — only the artifact prefix changes:

```text
# --matrix atomic  (default; atomic-crossos matrix)
#   artifact: schema-drift-diff-replay-pretty-index-failure-<os>
#     - artifacts/.../pretty-index.json
#     - artifacts/.../pretty-index.pre-check.json
#     - artifacts/.../pretty-index.report.json

# --matrix stress  (nightly-stress matrix)
#   artifact: schema-drift-diff-stress-replay-pretty-index-failure-<os>
#     - ...same three files...
```

All three entry points write the same sibling `.pre-check.json` /
`.report.json` files and print a step-summary-style failure block on
non-zero exit. See `docs/schema-drift-diff-test-hooks.md` for the full
exit-code contract.

#### Exact CI commands (mirror the step-summary artifact prefix without guessing)

Copy-paste these to reproduce **exactly** what each CI matrix runs. The
only thing that differs between atomic and stress is the artifact
prefix printed in the step-summary failure block — the underlying
validator command is identical.

```sh
# ── atomic-crossos matrix ────────────────────────────────────────────
# CI artifact on failure: schema-drift-diff-replay-pretty-index-failure-<os>
make pretty-index-check MATRIX=atomic
scripts/reproduce-ci-pretty-index-check.sh --matrix atomic \
  artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json
pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Matrix atomic `
  artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json

# ── nightly-stress matrix ────────────────────────────────────────────
# CI artifact on failure: schema-drift-diff-stress-replay-pretty-index-failure-<os>
make pretty-index-check MATRIX=stress
scripts/reproduce-ci-pretty-index-check.sh --matrix stress \
  artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json
pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Matrix stress `
  artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json
```

`MATRIX` (Makefile) / `--matrix` (bash) / `-Matrix` (PowerShell) all
default to `atomic`. Passing an unknown value (e.g. `MATRIX=bogus`)
exits with code **2** and prints `--matrix must be atomic|stress`
without any misleading validator-failure step-summary block.




### Pre-commit hook — skipping the pretty-index check

The pre-commit hook only runs the pretty-index CI check when a staged
file can actually affect the schema contract (the generator, validator,
migrator, self-check, local runner, or a committed `pretty-index.json`).
Docs-only or unrelated changes (e.g. `README.md`, `docs/**`, `src/**`)
skip it automatically.

Overrides:

```sh
PRETTY_INDEX_HOOK_SKIP=1 git commit ...            # force-skip even when relevant files staged
PRETTY_INDEX_HOOK_FORCE=1 git commit ...           # force-run even for docs-only commits
PRETTY_INDEX_HOOK_MATRIX=stress git commit ...     # reproduce nightly-stress artifact naming
PRETTY_INDEX_HOOK_MATRIX=atomic git commit ...     # (default) atomic-crossos naming
git commit --no-verify                             # skip every pre-commit hook (emergency)
```

An unknown `PRETTY_INDEX_HOOK_MATRIX` value aborts the hook with exit
code **2** and prints `PRETTY_INDEX_HOOK_MATRIX must be atomic|stress`.

#### `PRETTY_INDEX_HOOK_DRY_RUN=1`

Prints exactly what the hook *would* run — the reproduce command, the
expected diagnostic paths, and the CI artifact prefix for the current
`PRETTY_INDEX_HOOK_MATRIX` — then exits **0** without invoking the
reproduce script and without creating or modifying any diagnostic
artifacts. A bogus `PRETTY_INDEX_HOOK_MATRIX` still aborts fail-fast
with exit **2** before dry-run inspection.

Paths printed:

- `input     : artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json`
- `pre-check : ….pre-check.json`
- `report    : ….report.json`
- CI artifact prefix (`schema-drift-diff-replay-…` for atomic, `…-stress-replay-…` for stress)
- Documented exit codes (`0/1/2/3/4`)

Copy-paste:

```sh
PRETTY_INDEX_HOOK_DRY_RUN=1 PRETTY_INDEX_HOOK_FORCE=1 .githooks/pre-commit
PRETTY_INDEX_HOOK_DRY_RUN=1 PRETTY_INDEX_HOOK_MATRIX=stress PRETTY_INDEX_HOOK_FORCE=1 .githooks/pre-commit
make pretty-index-hook-dry-run           # atomic + stress in one shot
```


### Exit codes reference

`scripts/reproduce-ci-pretty-index-check.sh` / `.ps1` / `make
pretty-index-check` all share the same exit code contract:

| Exit | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 0    | OK — pretty-index.json passes the CI check                           |
| 1    | Schema drift (generator self-check found a `schema_version` mismatch)|
| 2    | Usage error (unknown/missing flag, bogus `--matrix` / `MATRIX` value)|
| 3    | Schema validation failed (`validate-pretty-index.py --require-version`) |
| 4    | Input file not found                                                 |

Bogus `MATRIX` value — expected output (stderr, exit **2**, no
misleading validator or artifact-prefix diagnostics):

```text
$ make pretty-index-check MATRIX=bogus
reproduce-ci-pretty-index-check: --matrix must be atomic|stress (got: bogus)
```

Pretty-index validation failure — expected step-summary block (stderr,
exit **1** or **3** depending on which check tripped):

```text
################################################################################
# ❌ pretty-index.json check failed (exit 3)
#
# In CI this would upload the following artifact and append a link block
# to $GITHUB_STEP_SUMMARY:
#
#   artifact: schema-drift-diff-replay-pretty-index-failure-<os>   (matrix: atomic)
#     - artifacts/.../pretty-index.json
#     - artifacts/.../pretty-index.pre-check.json   (raw generator output BEFORE --auto-migrate)
#     - artifacts/.../pretty-index.report.json      (validator --report machine-readable errors)
#
# Exit code legend: 1=schema drift, 3=schema validation, 4=missing file
# Re-run with --clean to discard prior diagnostics, or --keep (default)
# to preserve them for debugging.
################################################################################
```


## License

Private.


