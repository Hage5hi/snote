# schema-drift CI artifacts

The strict-validation step in `.github/workflows/ci.yml` (job **check**,
step `schema-drift-view.sh --strict-manifest (fixture)`) uploads a single
artifact per run named:

```
schema-drift-fixture-validation
```

It is uploaded with `if: always()` so it is present on every strict-validation
failure — not just on green runs.

## Contents

The artifact preserves the on-disk layout under
`reports/_ci/schema-drift-fixture/`:

| Path inside artifact | What it is |
|---|---|
| `validation-report.json` | Machine-readable `--validation-report` output ( `totals`, `strict`, `schemaPath`, per-file `missing` / `mistyped` / `extra` / `parseError` ). |
| `pr-comment.md`          | Rendered Markdown body posted via `gh pr comment` on pull requests, and appended to the GitHub Actions job summary. |
| `drift-*.json`           | The per-browser + combined fixture manifests the step generated and validated. Useful for local replay. |

## How to download

### From the GitHub UI

1. Open the failed CI run.
2. Scroll to the **Artifacts** panel at the bottom of the summary page.
3. Click **schema-drift-fixture-validation** to download the zip.
4. Unzip; the two paths above appear at the archive root.

### From the CLI

```bash
gh run download <run-id> -n schema-drift-fixture-validation -D ./_drift-artifact
cat ./_drift-artifact/validation-report.json | jq '.totals'
cat ./_drift-artifact/pr-comment.md
```

## Reproducing the PR comment locally

Once you have `validation-report.json`, regenerate the exact PR-comment
Markdown body without re-running CI:

```bash
bun scripts/schema-drift-pr-comment.ts ./_drift-artifact/validation-report.json
# or write to a file:
bun scripts/schema-drift-pr-comment.ts ./_drift-artifact/validation-report.json \
  --out /tmp/pr-comment.md
```

The same `SCHEMA_DRIFT_ANNOTATION_MAX` / `SCHEMA_DRIFT_MISSING_CAP` /
`SCHEMA_DRIFT_MISTYPED_CAP` / `SCHEMA_DRIFT_EXTRA_CAP` env vars used by CI
apply here — the local output matches CI byte-for-byte when the same
values are set.
