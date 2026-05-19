# `i18n-allowlist-report.json` field reference

Produced by `scripts/i18n-allowlist-check.ts` (run via `bun run i18n:allowlist`
or `bun run i18n:allowlist:report`). Always written to
`reports/i18n-allowlist-report.json` — even when validation fails — so it can
be uploaded as a CI artifact and surfaced in the PR sticky comment.

A human-readable mirror lives at `reports/i18n-allowlist-report.md`.

## Top-level shape

```jsonc
{
  "ok": true,            // overall verdict — true iff schemaOk && driftOk && no fs errors
  "schemaOk": true,      // JSON Schema validation against .lintrc-i18n-allowlist.schema.json
  "driftOk": true,       // no missing/stale/duplicate/non-existent-file entries
  "totals": { /* see below */ },
  "groupedSchemaErrors": [ /* see below */ ],
  "entries":  [ /* per-entry results, see below */ ],
  "missing":  [ /* eslint-disable comments lacking an allowlist entry */ ],
  "stale":    [ /* allowlist entries lacking a matching source comment */ ]
}
```

## `totals`

Quick-glance counters. These are the four numbers surfaced in the PR
comment and the `i18n:allowlist:report` CLI output.

| Field          | Type   | Meaning                                                                                       |
| -------------- | ------ | --------------------------------------------------------------------------------------------- |
| `entries`      | number | Total entries in `.lintrc-i18n-allowlist.json` (after schema validation).                     |
| `schemaErrors` | number | Count of Ajv schema violations across the whole file. `0` ⇒ `schemaOk: true`.                 |
| `missing`      | number | `eslint-disable … no-restricted-syntax -- <reason>` comments in `src/` with no matching entry. |
| `stale`        | number | Allowlist entries whose `{file, reason}` no longer matches any disable comment in `src/`.     |

**Rule of thumb:** any non-zero `schemaErrors`, `missing`, or `stale` ⇒
`ok: false` ⇒ the CI gate fails.

## `schemaOk` vs `driftOk`

These two booleans split the failure mode into "shape problem" vs
"source ↔ allowlist mismatch":

- **`schemaOk: false`** — `.lintrc-i18n-allowlist.json` is structurally wrong
  (missing required field, unknown key, wrong type). Fix the file shape;
  see `groupedSchemaErrors` for field-level paths and key suggestions.
- **`driftOk: false`** — the file is structurally valid but is out of sync
  with the source tree. Either:
    - A new `eslint-disable -- <reason>` was added without an allowlist
      entry → see `missing[]` (file + line + reason), **or**
    - An allowlist entry no longer matches any disable comment →
      see `stale[]` (`"<file>::<reason>"` keys to remove).

If both are `true` and the `totals` are all green, **`ok` will be `true`**.

## `groupedSchemaErrors`

```jsonc
[
  {
    "group": "entries[2]",
    "messages": [
      "/entries/2: missing required field \"reason\" (expected one of: file, reason, notes)",
      "/entries/2: unknown key \"reson\" — did you mean \"reason\"? (allowed: file, reason, notes)"
    ]
  }
]
```

Each entry groups all Ajv errors for the same location (`(root)` or
`entries[i]`). Messages include exact JSON Pointer paths and — for typo'd
keys — a Levenshtein-based suggestion.

## `entries[]`

Per-entry result row. Mirrors the rows rendered in the markdown report.

| Field             | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `index`           | Position in `.lintrc-i18n-allowlist.json` `entries[]`.             |
| `file`            | Source file the entry is scoped to.                                |
| `reason`          | Justification string (must match the `-- <reason>` suffix).        |
| `schemaOk`        | Per-entry schema verdict.                                          |
| `fileExists`      | `false` if the listed `file` is missing from disk.                 |
| `duplicate`       | `true` when another entry has the same `{file, reason}`.           |
| `matchedInSource` | `true` when at least one disable comment in source matches.        |
| `matchedSites`    | `[{ file, line }]` of each source disable comment that matched.    |
| `errors`          | Human-readable per-entry problems (`"file does not exist"`, etc.). |

## `missing[]` and `stale[]`

- `missing[]` — `{ file, reason, line }` for every disable comment that
  doesn't have an allowlist entry. **Action:** add a matching
  `{file, reason}` to `.lintrc-i18n-allowlist.json` (or wrap the string in
  `t()` if it's actually user-facing copy).
- `stale[]` — `"<file>::<reason>"` strings for every allowlist entry the
  scanner couldn't find in source. **Action:** delete them from
  `.lintrc-i18n-allowlist.json`.

## Reading the report quickly

```bash
bun run i18n:allowlist:report
```

prints:

```
i18n allowlist report  ✅ PASS
  path:       reports/i18n-allowlist-report.json
  schemaOk:   ✅ (0 errors)
  driftOk:    ✅
  entries:    8
  missing:    0  (unallowlisted disables)
  stale:      0  (entries with no source match)
```

The same numbers appear in the PR sticky comment posted by
`.github/workflows/ci.yml` (`Comment PR with i18n artifact links + summary`).
