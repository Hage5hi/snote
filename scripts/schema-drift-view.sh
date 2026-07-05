#!/usr/bin/env bash
# Pretty-print / side-by-side view of the drift bundle written by
# `bun run schema-guard` (or the CI schema-guard workflow's `schema-drift`
# artifact once unzipped into ./_schema_drift/).
#
# Usage:
#   scripts/schema-drift-view.sh                          # print all diffs
#   scripts/schema-drift-view.sh types                    # only .types.gen.ts.diff
#   scripts/schema-drift-view.sh schemas                  # only *.schema.json.diff
#   scripts/schema-drift-view.sh --file report            # substring-match a filename
#   scripts/schema-drift-view.sh --type schema            # schema | types
#   scripts/schema-drift-view.sh --viewer delta           # diff-y | delta | bat | cat
#   OUT=./somewhere/_schema_drift scripts/schema-drift-view.sh
set -euo pipefail

OUT="${OUT:-_schema_drift}"
FILTER="all"
FILE_MATCH=""
VIEWER="auto"   # auto | diff-y | delta | bat | cat

while [ $# -gt 0 ]; do
  case "$1" in
    --file)    FILE_MATCH="${2:-}"; shift 2 ;;
    --file=*)  FILE_MATCH="${1#*=}"; shift ;;
    --type)    FILTER="${2:-all}"; shift 2 ;;
    --type=*)  FILTER="${1#*=}"; shift ;;
    --viewer)  VIEWER="${2:-auto}"; shift 2 ;;
    --viewer=*) VIEWER="${1#*=}"; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    all|types|schemas) FILTER="$1"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
# Normalize `--type schema` (singular) → `schemas`.
[ "$FILTER" = "schema" ] && FILTER="schemas"
[ "$FILTER" = "type" ]   && FILTER="types"

if [ ! -d "$OUT" ]; then
  echo "no drift bundle at $OUT — run: bun run schema-guard" >&2
  exit 1
fi

COLS=$(tput cols 2>/dev/null || echo 160)
# Resolve viewer preference.
resolve_viewer() {
  case "$VIEWER" in
    diff-y|diff|side-by-side) echo "diff-y" ;;
    delta) command -v delta >/dev/null && echo "delta" || echo "cat" ;;
    bat)   command -v bat   >/dev/null && echo "bat"   || echo "cat" ;;
    cat)   echo "cat" ;;
    auto)
      if [ "$COLS" -ge 180 ]; then echo "diff-y"
      elif command -v delta >/dev/null 2>&1; then echo "delta"
      elif command -v bat   >/dev/null 2>&1; then echo "bat"
      else echo "cat"; fi ;;
    *) echo "unknown --viewer: $VIEWER" >&2; exit 2 ;;
  esac
}
RESOLVED_VIEWER="$(resolve_viewer)"

pretty() {
  case "$RESOLVED_VIEWER" in
    delta) delta --side-by-side --width "$COLS" ;;
    bat)   bat -l diff --paging=never ;;
    *)     cat ;;
  esac
}

show() {
  local base="$1"
  [ -n "$FILE_MATCH" ] && [[ "$base" != *"$FILE_MATCH"* ]] && return 0
  local committed="$OUT/committed/$base"
  local regen="$OUT/regenerated/$base"
  local diff_file="$OUT/${base}.diff"

  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  $base   [viewer=$RESOLVED_VIEWER]"
  echo "══════════════════════════════════════════════════════════════"

  if [ ! -s "$diff_file" ]; then
    echo "  (no drift for this file)"
    return
  fi

  if [ "$RESOLVED_VIEWER" = "diff-y" ] && [ -s "$committed" ] && [ -s "$regen" ]; then
    diff -y --width="$COLS" "$committed" "$regen" || true
  else
    pretty < "$diff_file"
  fi
}

case "$FILTER" in
  types)   show "focus-trap-inspect-schema.types.gen.ts" ;;
  schemas) show "focus-trap-inspect-report.schema.json"
           show "focus-trap-inspect-diff.schema.json" ;;
  all|"")  show "focus-trap-inspect-report.schema.json"
           show "focus-trap-inspect-diff.schema.json"
           show "focus-trap-inspect-schema.types.gen.ts" ;;
  *) echo "usage: $0 [all|types|schemas] [--file <substr>] [--type schemas|types] [--viewer auto|diff-y|delta|bat|cat]" >&2; exit 2 ;;
esac

if [ -s "$OUT/cli-schema-versions.txt" ]; then
  echo ""
  echo "── CLI SCHEMA_VERSION consts ──────────────────────────────────"
  cat "$OUT/cli-schema-versions.txt"
fi
echo ""
echo "Bundle: $OUT/  (viewer=$RESOLVED_VIEWER, cols=$COLS, filter=$FILTER, file~='${FILE_MATCH}')"
