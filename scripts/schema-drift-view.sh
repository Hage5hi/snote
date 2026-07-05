#!/usr/bin/env bash
# Pretty-print / side-by-side view of the drift bundle written by
# `bun run schema-guard` (or the CI schema-guard workflow's `schema-drift`
# artifact once unzipped into ./_schema_drift/).
#
# Usage:
#   bun run scripts/schema-drift-view.sh              # print all diffs
#   bun run scripts/schema-drift-view.sh types        # only .types.gen.ts.diff
#   bun run scripts/schema-drift-view.sh schemas      # only *.schema.json.diff
#   OUT=./somewhere/_schema_drift bun run scripts/schema-drift-view.sh
#
# Uses `diff -y` (side-by-side) when the terminal is wide enough, else
# falls back to the unified diffs already on disk. Highlights with
# `delta` or `bat` when available; plain cat otherwise.
set -euo pipefail

OUT="${OUT:-_schema_drift}"
if [ ! -d "$OUT" ]; then
  echo "no drift bundle at $OUT — run: bun run schema-guard" >&2
  exit 1
fi

FILTER="${1:-all}"
COLS=$(tput cols 2>/dev/null || echo 160)
SIDE_BY_SIDE=0
[ "$COLS" -ge 180 ] && SIDE_BY_SIDE=1

pretty() {
  if command -v delta >/dev/null 2>&1; then delta --side-by-side --width "$COLS"
  elif command -v bat >/dev/null 2>&1;   then bat -l diff --paging=never
  else cat
  fi
}

show() {
  local base="$1"
  local committed="$OUT/committed/$base"
  local regen="$OUT/regenerated/$base"
  local diff_file="$OUT/${base}.diff"

  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  $base"
  echo "══════════════════════════════════════════════════════════════"

  if [ ! -s "$diff_file" ]; then
    echo "  (no drift for this file)"
    return
  fi

  if [ "$SIDE_BY_SIDE" = "1" ] && [ -s "$committed" ] && [ -s "$regen" ]; then
    diff -y --width="$COLS" "$committed" "$regen" || true
  else
    pretty < "$diff_file"
  fi
}

case "$FILTER" in
  types)
    show "focus-trap-inspect-schema.types.gen.ts" ;;
  schemas)
    show "focus-trap-inspect-report.schema.json"
    show "focus-trap-inspect-diff.schema.json" ;;
  all|"")
    show "focus-trap-inspect-report.schema.json"
    show "focus-trap-inspect-diff.schema.json"
    show "focus-trap-inspect-schema.types.gen.ts" ;;
  *)
    echo "usage: $0 [all|types|schemas]" >&2; exit 2 ;;
esac

if [ -s "$OUT/cli-schema-versions.txt" ]; then
  echo ""
  echo "── CLI SCHEMA_VERSION consts ──────────────────────────────────"
  cat "$OUT/cli-schema-versions.txt"
fi
echo ""
echo "Bundle: $OUT/  (side-by-side=$SIDE_BY_SIDE, cols=$COLS)"
