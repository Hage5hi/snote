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
# expected, matched, requiredArtifacts). No diff/viewer runs.
bun run schema-guard:view -- --manifest-dir reports/_ci --manifest-prefix drift --validate-manifest
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



## License

Private.

