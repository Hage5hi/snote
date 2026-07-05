#!/usr/bin/env bash
# schema-drift-view — pretty-print the drift bundle written by
# `bun run schema-guard` (or the CI schema-guard workflow's `schema-drift`
# artifact once unzipped into ./_schema_drift/).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/schema-drift-view.sh [POSITIONAL] [FLAGS]

Positional (optional):
  all | types | schemas          Shorthand for --type

Flags:
  --type    schemas|types|all    Restrict to schema JSON diffs, types.gen.ts diff, or both.
  --file    <substr>             Show only files whose name contains <substr>.
                                 Repeatable. Also accepts comma-separated values.
  --exclude <substr>             Skip files whose name contains <substr>. Applied AFTER
                                 --file. Repeatable + comma-separated. Useful for hiding
                                 noisy bases without changing --type.
  --browsers <list>              Comma-separated Playwright projects (chromium,firefox,webkit)
                                 to scope manifest + diff/viewer output to. Repeatable.
                                 Default: all browsers.
  --viewer  auto|diff-y|delta|bat|cat
                                 Force a viewer. `auto` (default) picks diff -y when the
                                 terminal is ≥180 cols, else delta, then bat, then cat.
  --dry-run                      Print which files would match and the diff/view command
                                 that would run — no file reads, no bundle required.
  --verbose                      Trace matched files, the resolved viewer command per
                                 file, and echo executed subprocess output to stderr.
  -h, --help                     Show this help.

Env:
  OUT                            Drift bundle directory. Default: _schema_drift

Examples:
  # All diffs, auto viewer (side-by-side if the terminal is wide enough)
  scripts/schema-drift-view.sh

  # Only the .types.gen.ts diff
  scripts/schema-drift-view.sh --type types
  scripts/schema-drift-view.sh types            # positional shorthand

  # Only the two schema JSON diffs
  scripts/schema-drift-view.sh --type schemas

  # Filter by substring (repeatable + comma-separated both work)
  scripts/schema-drift-view.sh --file report
  scripts/schema-drift-view.sh --file report --file diff
  scripts/schema-drift-view.sh --file report,diff

  # Force a specific viewer regardless of terminal width
  scripts/schema-drift-view.sh --viewer diff-y
  scripts/schema-drift-view.sh --viewer delta
  scripts/schema-drift-view.sh --viewer bat
  scripts/schema-drift-view.sh --viewer cat

  # Point at an unzipped CI artifact
  OUT=./downloads/schema-drift scripts/schema-drift-view.sh --type schemas
EOF
}

OUT="${OUT:-_schema_drift}"
FILTER="all"
FILE_MATCHES=()     # each entry is one substring
FILE_EXCLUDES=()    # each entry is one substring to skip
BROWSERS=()         # each entry is one playwright project name
VIEWER="auto"
DRY_RUN=0
VERBOSE=0

add_to() {
  # $1 = nameref array, $2 = comma-list
  local -n _arr=$1
  local IFS=,
  # shellcheck disable=SC2206
  local parts=($2)
  for p in "${parts[@]}"; do [ -n "$p" ] && _arr+=("$p"); done
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file)       add_to FILE_MATCHES  "${2:-}"; shift 2 ;;
    --file=*)     add_to FILE_MATCHES  "${1#*=}"; shift ;;
    --exclude)    add_to FILE_EXCLUDES "${2:-}"; shift 2 ;;
    --exclude=*)  add_to FILE_EXCLUDES "${1#*=}"; shift ;;
    --browsers)   add_to BROWSERS      "${2:-}"; shift 2 ;;
    --browsers=*) add_to BROWSERS      "${1#*=}"; shift ;;
    --type)       FILTER="${2:-all}"; shift 2 ;;
    --type=*)     FILTER="${1#*=}"; shift ;;
    --viewer)     VIEWER="${2:-auto}"; shift 2 ;;
    --viewer=*)   VIEWER="${1#*=}"; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --verbose|-v) VERBOSE=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    all|types|schemas) FILTER="$1"; shift ;;
    *) echo "unknown arg: $1" >&2; echo "" >&2; usage >&2; exit 2 ;;
  esac
done
[ "$FILTER" = "schema" ] && FILTER="schemas"
[ "$FILTER" = "type" ]   && FILTER="types"

vlog() { [ "$VERBOSE" = "1" ] && echo "[verbose] $*" >&2 || true; }

# --dry-run must work without a bundle on disk so it's usable as a
# planning/preview step and in unit tests. All other modes require OUT.
if [ ! -d "$OUT" ] && [ "$DRY_RUN" != "1" ]; then
  echo "no drift bundle at $OUT — run: bun run schema-guard" >&2
  exit 1
fi

COLS=$(tput cols 2>/dev/null || echo 160)
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

matches_filter() {
  local base="$1" m
  # --exclude wins over --file (skip if any exclude matches).
  for m in "${FILE_EXCLUDES[@]}"; do
    [[ "$base" == *"$m"* ]] && return 1
  done
  # No --file filters ⇒ everything passes.
  [ "${#FILE_MATCHES[@]}" -eq 0 ] && return 0
  for m in "${FILE_MATCHES[@]}"; do
    [[ "$base" == *"$m"* ]] && return 0
  done
  return 1
}

show() {
  local base="$1"
  if ! matches_filter "$base"; then
    vlog "skip $base (--file/--exclude filter)"
    [ "$DRY_RUN" = "1" ] && echo "SKIP  $base  (filtered by --file/--exclude)"
    return 0
  fi
  local committed="$OUT/committed/$base"
  local regen="$OUT/regenerated/$base"
  local diff_file="$OUT/${base}.diff"

  local cmd
  if [ "$RESOLVED_VIEWER" = "diff-y" ]; then
    cmd="diff -y --width=$COLS $committed $regen"
  else
    cmd="pretty($RESOLVED_VIEWER) < $diff_file"
  fi
  vlog "match $base → $cmd"

  if [ "$DRY_RUN" = "1" ]; then
    echo "MATCH $base  →  $cmd"
    return 0
  fi

  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  $base   [viewer=$RESOLVED_VIEWER]"
  echo "══════════════════════════════════════════════════════════════"

  if [ ! -s "$diff_file" ]; then
    echo "  (no drift for this file)"
    return
  fi

  if [ "$RESOLVED_VIEWER" = "diff-y" ] && [ -s "$committed" ] && [ -s "$regen" ]; then
    if [ "$VERBOSE" = "1" ]; then
      diff -y --width="$COLS" "$committed" "$regen" | tee /dev/stderr || true
    else
      diff -y --width="$COLS" "$committed" "$regen" || true
    fi
  else
    if [ "$VERBOSE" = "1" ]; then
      pretty < "$diff_file" | tee /dev/stderr
    else
      pretty < "$diff_file"
    fi
  fi
}

case "$FILTER" in
  types)   show "focus-trap-inspect-schema.types.gen.ts" ;;
  schemas) show "focus-trap-inspect-report.schema.json"
           show "focus-trap-inspect-diff.schema.json" ;;
  all|"")  show "focus-trap-inspect-report.schema.json"
           show "focus-trap-inspect-diff.schema.json"
           show "focus-trap-inspect-schema.types.gen.ts" ;;
  *) echo "unknown --type: $FILTER" >&2; usage >&2; exit 2 ;;
esac

if [ "$DRY_RUN" != "1" ] && [ -s "$OUT/cli-schema-versions.txt" ]; then
  echo ""
  echo "── CLI SCHEMA_VERSION consts ──────────────────────────────────"
  cat "$OUT/cli-schema-versions.txt"
fi
echo ""
files_str="${FILE_MATCHES[*]:-<none>}"
excludes_str="${FILE_EXCLUDES[*]:-<none>}"
browsers_str="${BROWSERS[*]:-<all>}"
echo "Bundle: $OUT/  (viewer=$RESOLVED_VIEWER, cols=$COLS, type=$FILTER, files=[${files_str}], exclude=[${excludes_str}], browsers=[${browsers_str}], verbose=${VERBOSE})"
