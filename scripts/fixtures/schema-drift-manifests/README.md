# schema-drift manifest fixtures

Small, hand-authored manifest examples that exercise every failure mode of
`scripts/schema-drift-view.sh --validate-manifest` / `--strict-manifest`.

Each subdirectory contains exactly one manifest so you can point the
validator at it directly:

| Fixture           | What's wrong                                            | Expected exit |
|-------------------|---------------------------------------------------------|---------------|
| `valid/`          | Schema-conformant baseline                              | `0`           |
| `missing-nested/` | Missing top-level required keys (`requiredArtifacts`, …)| `1`           |
| `wrong-types/`    | `combined` is a string, `matches` is `number[]`         | `1`           |
| `extra-keys/`     | Adds `unknownField` / `anotherExtra` (strict-only fail) | `1` (strict)  |

## Reproduce locally

One command per fixture — no bundle, no CI, no Playwright:

```sh
# Passes
bash scripts/schema-drift-view.sh --strict-manifest \
  --manifest-dir scripts/fixtures/schema-drift-manifests/valid \
  --manifest-prefix drift

# Fails: missing required keys (both --validate-manifest and --strict-manifest)
bash scripts/schema-drift-view.sh --validate-manifest \
  --manifest-dir scripts/fixtures/schema-drift-manifests/missing-nested \
  --manifest-prefix drift

# Fails: wrong value types
bash scripts/schema-drift-view.sh --strict-manifest \
  --manifest-dir scripts/fixtures/schema-drift-manifests/wrong-types \
  --manifest-prefix drift

# Fails only under --strict-manifest (extra keys are ignored by --validate-manifest)
bash scripts/schema-drift-view.sh --strict-manifest \
  --manifest-dir scripts/fixtures/schema-drift-manifests/extra-keys \
  --manifest-prefix drift
```

Add `--validation-report /tmp/report.json` to any of the above to inspect
the machine-readable output (see README §"--validation-report JSON").
