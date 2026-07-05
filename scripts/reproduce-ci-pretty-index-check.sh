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
#   scripts/reproduce-ci-pretty-index-check.sh [path/to/pretty-index.json]
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
INDEX="${1:-artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json}"

if [ ! -f "$INDEX" ]; then
  echo "reproduce-ci-pretty-index-check: file not found: $INDEX" >&2
  echo "  hint: run the pretty-replay-summary generator first, or pass a path" >&2
  exit 4
fi

PRE="${INDEX%.json}.pre-check.json"
REPORT="${INDEX%.json}.report.json"

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
################################################################################
EOF
  exit "$rc"
fi

echo
echo "✅ pretty-index.json passes the same check CI runs."
echo "   report: $REPORT"
echo "   pre-check snapshot: $PRE"
