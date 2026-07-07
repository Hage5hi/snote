# Changelog

All notable changes to the schema-drift tooling in `scripts/` are
documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### PWA update — readiness validator

#### Added

- **`snote:pwa-readiness-invalid` CustomEvent** — dispatched on `window` by
  `<PwaUpdateDebugPanel>` (DEV) and `emitPwaReadinessInvalidEvent()` whenever
  `window.__SNOTE_PWA_UPDATE_STATE__` fails the shared schema in
  `src/lib/pwa-update-readiness.ts`. Fail-fast: one event per rejection,
  reporting the first invalid field.
  - `detail` shape (`PwaReadinessInvalidEventDetail`):
    - `field: string` — invalid field name (e.g. `"reloadStrategy"`, `"<root>"`)
    - `path: string` — alias of `field` (dot-path style for QA tooling)
    - `reason: string` — human-readable failure description
    - `received: string` — `typeof` / stringified value that failed
  - Canonical event name exported as `PWA_READINESS_INVALID_EVENT`.
  - Augments `WindowEventMap` so `addEventListener` is fully typed.
  - See `docs/pwa-readiness-invalid-event.md` for the QA debug guide.



### `scripts/schema-drift-diff.ts`

#### Added

- **`--json-out <path>`** — writes the `--json` payload to `<path>`
  atomically. The tool writes to a sibling `<path>.<pid>.tmp` and then
  `renameSync`s it into place, so readers never observe a partial or
  truncated file. Auto-creates missing parent directories via `mkdir -p`.
  Implies `--json`.
- **`--validate-json`** — runs the `--json` payload through Ajv against
  [`schemas/schema-drift-diff.schema.json`](schemas/schema-drift-diff.schema.json)
  before writing. On success prints `validate-json: OK (<schema>)` to
  stderr. On failure emits a structured JSON error payload to stderr
  containing `error`, `code`, `schemaPath`, `message`, `ajvErrors[]`
  (each with `instancePath`, `schemaPath`, `keyword`, `message`,
  `params`), `expectedChecklist`, and `fix`.
- **`--print-schema`** — prints the bundled JSON Schema
  (`schemas/schema-drift-diff.schema.json`) to stdout and exits `0`. Use
  it to snapshot the schema into other repos or CI validators without
  hard-coding a path into this checkout.
- **Wildcard / regex patterns** for `--fail-slug` and `--kind`. Each
  flag now accepts exact strings, `*`/`?` globs (regex metacharacters
  escaped), or `/regex/flags` forms. Both flags are repeatable and
  accept comma-separated lists in one argument.
- **`--help`** now includes runnable `Examples:` for `--json`,
  `--json-out`, `--validate-json`, wildcard/regex `--fail-slug`/`--kind`,
  and `--print-schema`.
- **JSON-friendly load errors**: when `--json` (or `--json-out`) is
  active, `loadReport` emits `report-unreadable` (`3`),
  `report-invalid-json` (`4`), and `report-missing-fields` (`5`) as
  structured JSON on stderr with `receivedTopLevelKeys`,
  `missingTopLevelKeys`, `expectedChecklist`, `expectedShape`, and `fix`.

#### Changed

- **Exit codes** (all documented in `README.md`):
  - `0` success
  - `2` bad CLI usage (unknown flag, missing value, `--kind` pattern
    matched no known kinds, `--validate-json` without `--json`, etc.)
  - `3` report file missing / unreadable
  - `4` report file is not valid JSON
  - `5` report file is missing required top-level fields
  - `6` **new** — `--validate-json` schema mismatch (Ajv errors emitted)
  - `7` **new** — `--json-out` / `--out` destination not writable
    (rename failure, permission denied, blocked parent path). The
    tool cleans up any `<path>.<pid>.tmp` file before exiting.

- The text-mode exit `5` error now also prints the exact received
  top-level keys and an `[x] / [ ]` expected-schema checklist.

### `scripts/schema-drift-pr-comment.ts`

- No behavioural changes in this release. The shared `anchorFor` helper
  continues to produce deterministic `fail-<scope>-<slug>` anchors used
  by both `pr-comment.md` and the diff CLI's `matchedAnchors`.
