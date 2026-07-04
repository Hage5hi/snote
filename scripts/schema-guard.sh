#!/usr/bin/env bash
# Local schema-guard dry-run: mirrors the CI workflow's dry_run mode.
# Regenerates the JSON Schemas + TypeScript types, captures per-file
# unified diffs under _schema_drift/, prints them, and ALWAYS exits 0
# so you can preview drift before CI blocks the merge.
#
# Usage:
#   bun run schema-guard          # regenerate, print diffs, never fails
#   bun run schema-guard -- --strict   # exit 1 on drift (parity with CI)
set -euo pipefail

STRICT=0
for a in "$@"; do
  [ "$a" = "--strict" ] && STRICT=1
done

OUT=_schema_drift
rm -rf "$OUT"
mkdir -p "$OUT/committed" "$OUT/regenerated"

FILES=(
  "scripts/_helpers/focus-trap-inspect-schema.types.gen.ts"
  "schemas/focus-trap-inspect-report.schema.json"
  "schemas/focus-trap-inspect-diff.schema.json"
)

for f in "${FILES[@]}"; do
  cp "$f" "$OUT/committed/$(basename "$f")"
done

drift=0
if ! bun run schema:types:check > "$OUT/check.log" 2>&1; then
  drift=1
  bun run schema:types || true
  for f in "${FILES[@]}"; do
    cp "$f" "$OUT/regenerated/$(basename "$f")"
    base=$(basename "$f")
    diff -u "$OUT/committed/$base" "$OUT/regenerated/$base" > "$OUT/${base}.diff" || true
  done
  grep -E 'SCHEMA_VERSION\s*=' scripts/_helpers/focus-trap-inspect.ts \
    > "$OUT/cli-schema-versions.txt" || true

  # Restore committed files so a local preview doesn't leave the working
  # tree dirty. Comment the loop out if you want to inspect the changes
  # in-place; `bun run schema:types` will regenerate them again.
  for f in "${FILES[@]}"; do
    cp "$OUT/committed/$(basename "$f")" "$f"
  done
fi

echo ""
if [ "$drift" = "0" ]; then
  echo "✓ schema-guard: no drift"
  exit 0
fi

echo "⚠ schema-guard: drift detected — printing diffs"
echo ""
for f in "${FILES[@]}"; do
  d="$OUT/$(basename "$f").diff"
  [ -s "$d" ] || continue
  echo "── $(basename "$f") ────────────────────────────────"
  cat "$d"
  echo ""
done
if [ -s "$OUT/cli-schema-versions.txt" ]; then
  echo "── CLI SCHEMA_VERSION consts ──"
  cat "$OUT/cli-schema-versions.txt"
  echo ""
fi
echo "Bundle: $OUT/  (committed/, regenerated/, per-file *.diff)"

if [ "$STRICT" = "1" ]; then
  echo "✗ exiting 1 (--strict)"; exit 1
fi
echo "(dry-run: exiting 0)"
