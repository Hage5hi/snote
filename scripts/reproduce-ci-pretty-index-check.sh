#!/usr/bin/env bash
# Reproduce the CI pretty-index check flow locally, end to end, so you
# can catch schema drift before pushing. Mirrors the CI steps in
# .github/workflows/ci.yml:
#
#   1. snapshot the generator output (pretty-index.pre-check.json)
#   2. run scripts/check-pretty-index-local.sh --report (self-check + validator)
#   3. on failure, print a step-summary-style block pointing at the
#      exact files CI would upload as failure diagnostics
#
# Usage:
#   scripts/reproduce-ci-pretty-index-check.sh \
#     [--clean|--keep] [path/to/pretty-index.json]
#
# Flags:
#   --clean   Remove any pre-existing sibling .pre-check.json / .report.json
#             BEFORE running (fresh diagnostic state).
#   --keep    (default) Leave existing diagnostic artifacts in place so
#             successive runs preserve history for debugging.
#
# Defaults to
#   artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json
# (the same path the CI matrices use), and writes sibling
# `.pre-check.json` and `.report.json` files next to it — identical
# names and layout to the CI failure artifact.
#
# Exit codes match check-pretty-index-local.sh (0/1/3/4/2), so wire this
# into a pre-push hook if you want.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLEAN=0
MATRIX="atomic"
INDEX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) CLEAN=1; shift ;;
    --keep)  CLEAN=0; shift ;;
    --matrix)
      shift
      if [ $# -eq 0 ]; then
        echo "reproduce-ci-pretty-index-check: --matrix requires atomic|stress" >&2
        exit 2
      fi
      MATRIX="$1"; shift ;;
    --matrix=*) MATRIX="${1#--matrix=}"; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    --*) echo "reproduce-ci-pretty-index-check: unknown flag: $1" >&2; exit 2 ;;
    *)
      if [ -n "$INDEX" ]; then
        echo "reproduce-ci-pretty-index-check: unexpected extra argument: $1" >&2
        exit 2
      fi
      INDEX="$1"; shift ;;
  esac
done

case "$MATRIX" in
  atomic) ARTIFACT_PREFIX="schema-drift-diff-replay-pretty-index-failure" ;;
  stress) ARTIFACT_PREFIX="schema-drift-diff-stress-replay-pretty-index-failure" ;;
  *) echo "reproduce-ci-pretty-index-check: --matrix must be atomic|stress (got: $MATRIX)" >&2; exit 2 ;;
esac
INDEX="${INDEX:-artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json}"

if [ ! -f "$INDEX" ]; then
  echo "reproduce-ci-pretty-index-check: file not found: $INDEX" >&2
  echo "  hint: run the pretty-replay-summary generator first, or pass a path" >&2
  exit 4
fi

PRE="${INDEX%.json}.pre-check.json"
REPORT="${INDEX%.json}.report.json"

if [ "$CLEAN" -eq 1 ]; then
  echo "==> --clean: removing prior diagnostics ($PRE, $REPORT)"
  rm -f -- "$PRE" "$REPORT"
fi

echo "==> [0/2] snapshot generator output -> $PRE"
cp -- "$INDEX" "$PRE"

echo "==> [1..2/2] check-pretty-index-local.sh --report $REPORT $INDEX"
set +e
"$HERE/check-pretty-index-local.sh" --report "$REPORT" "$INDEX"
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
  cat >&2 <<EOF

################################################################################
# ❌ pretty-index.json check failed (exit $rc)
#
# In CI this would upload the following artifact and append a link block
# to \$GITHUB_STEP_SUMMARY:
#
#   artifact: schema-drift-diff-replay-pretty-index-failure-<os>
#     - $INDEX
#     - $PRE   (raw generator output BEFORE --auto-migrate)
#     - $REPORT (validator --report machine-readable errors)
#
# Exit code legend: 1=schema drift, 3=schema validation, 4=missing file
# Re-run with --clean to discard prior diagnostics, or --keep (default)
# to preserve them for debugging.
################################################################################
EOF
  exit "$rc"
fi

echo
echo "✅ pretty-index.json passes the same check CI runs."
echo "   report: $REPORT"
echo "   pre-check snapshot: $PRE"
