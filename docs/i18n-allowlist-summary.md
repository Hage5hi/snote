# `i18n:allowlist:summary` — CLI flags

```sh
bun run i18n:allowlist:summary [--changed] [--json] [--annotations] [--topFiles N]
```

Runs `scripts/i18n-allowlist-check.ts` silently, then prints a concise
PASS/FAIL view of `reports/i18n-allowlist-report.json`.

| Flag | Purpose |
|---|---|
| `--changed` | Scope drift counts to files touched in the working tree (`git diff` + `git ls-files --others`). Falls back to the full report when git is unavailable or no i18n-relevant file changed. Side-by-side `scoped / full repo` counts are rendered. |
| `--json` | Emit a stable machine-readable [`SummaryJSON`](../scripts/i18n-allowlist-report.ts) on stdout (also written to `reports/i18n-allowlist-summary.json` for upload as a CI artifact). |
| `--annotations` | Print GitHub workflow `::error file=…,line=…::` commands to **stderr** so they render as inline check annotations without polluting `--json` stdout. Schema + drift-missing entries include line numbers; drift-stale is file-only. |
| `--topFiles N` | Cap the number of top offending paths surfaced in the CLI text, JSON `failure.topFiles`, annotations, and PR comment. Default `3`, minimum `1`. Also accepts `--top-files N`/`--topFiles=N`. |

Exits non-zero on FAIL.

## Example: pretty text (default)

```text
i18n allowlist report  ❌ FAIL
  path:       reports/i18n-allowlist-report.json
  scope:      --changed (1 entry/entries + 2 missing + 0 stale relevant to your diff)
  schemaOk:   ✅ (0 errors)
  driftOk:    ❌
  entries:    1 (scoped) / 8 (full repo)
  missing:    2 (scoped) / 3 (full repo)  (unallowlisted disables)
  stale:      0 (scoped) / 1 (full repo)  (entries with no source match)
  reason:     drift (missing) — 2 unallowlisted no-restricted-syntax disables in source  →  src/widget.tsx:42, src/legacy/old.tsx:7
```

## Example: `--json`

```json
{
  "ok": false, "schemaOk": true, "driftOk": false,
  "scopedToChanges": true,
  "reportPath": "reports/i18n-allowlist-report.json",
  "counts":     { "entries": 1, "schemaErrors": 0, "missing": 2, "stale": 0 },
  "fullCounts": { "entries": 8, "schemaErrors": 0, "missing": 3, "stale": 1 },
  "failure": {
    "category": "drift-missing",
    "topFiles": ["src/widget.tsx:42", "src/legacy/old.tsx:7"],
    "reason":   "drift (missing) — 2 unallowlisted no-restricted-syntax disables in source  →  src/widget.tsx:42, src/legacy/old.tsx:7"
  }
}
```

## Example: `--annotations` (stderr)

```text
::error file=src/widget.tsx,line=42::i18n allowlist — drift (missing) — 2 unallowlisted no-restricted-syntax disables in source  →  src/widget.tsx:42, src/legacy/old.tsx:7
::error file=src/legacy/old.tsx,line=7::i18n allowlist — drift (missing) — …
```

Schema failures emit annotations pointing at the allowlist config with
the entry's start line, e.g.
`::error file=.lintrc-i18n-allowlist.json,line=42::i18n allowlist — schema validation failed — …`.

## CI usage

```yaml
- name: i18n allowlist summary (PR-scoped)
  run: bun run i18n:allowlist:summary --changed --json --annotations --topFiles 5

- uses: actions/upload-artifact@v4
  with:
    name: i18n-allowlist-summary
    path: reports/i18n-allowlist-summary.json
```

The summary JSON is consumed by the [PR comment builder](./i18n-ci-env-vars.md)
and a GitHub Check Run step so reviewers see the same one-line failure
category + top files in every surface.
