#!/usr/bin/env bash
# schema-drift-debug — one-shot local debugging wrapper.
#
# Runs BOTH scripts/schema-drift-summary.ts (terminal-readable) and
# scripts/schema-drift-pr-comment.ts (Markdown body, saved to disk)
# against a single validation-report.json so you get the terminal
# summary AND the path to the generated pr-comment.md in one command.
#
# Usage:
#   bash scripts/schema-drift-debug.sh <report.json> [--out-dir <dir>] [-- <extra filter flags>]
#
# Extra flags after `--` are forwarded verbatim to BOTH scripts, e.g.:
#   bash scripts/schema-drift-debug.sh report.json -- --browser chromium --kind mistyped
set -euo pipefail

if [ $# -lt 1 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '3,15p' "$0" >&2
  exit 2
fi

REPORT="$1"; shift
OUT_DIR="/tmp/schema-drift-debug"
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --out-dir=*) OUT_DIR="${1#*=}"; shift ;;
    --) shift; EXTRA=("$@"); break ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

mkdir -p "$OUT_DIR"
PR_MD="$OUT_DIR/pr-comment.md"

echo "── terminal summary ─────────────────────────────────────────"
bun scripts/schema-drift-summary.ts "$REPORT" "${EXTRA[@]}"
echo ""
bun scripts/schema-drift-pr-comment.ts "$REPORT" --out "$PR_MD" "${EXTRA[@]}"
echo "── pr-comment.md ────────────────────────────────────────────"
echo "wrote: $PR_MD"
