#!/usr/bin/env bash
# CI-only guard: assert that the rendered GitHub step summary contains
# direct links to BOTH `validate-report.json` and `validate-schema-assertion.txt`
# for both the atomic and stress `pretty-index-mismatch-ci` matrix runs.
#
# The link may be a single combined markdown link whose label mentions
# both filenames (as we currently render), or two separate links — either
# form satisfies the contract.
#
# Usage:
#   scripts/ci/assert-pi-ci-summary-links.sh <path-to-step-summary.md> [scope ...]
# `scope` defaults to "atomic stress"; pass a single scope to check only
# that matrix job's summary (each matrix job has its own summary file).
# Exits 0 on success, 2 on usage error, 1 when a link is missing.
set -euo pipefail

summary="${1:-${GITHUB_STEP_SUMMARY:-}}"
shift || true
scopes=("$@")
[ "${#scopes[@]}" -eq 0 ] && scopes=(atomic stress)

if [ -z "$summary" ] || [ ! -s "$summary" ]; then
  echo "usage: $0 <step-summary.md> [scope ...]  (or set GITHUB_STEP_SUMMARY)" >&2
  echo "ERROR: step summary file missing or empty: '$summary'" >&2
  exit 2
fi

fail=0
for scope in "${scopes[@]}"; do

  # Header line we always emit — its presence proves the summary block ran.
  if ! grep -Fq "pretty-index-mismatch-ci validator files (MATRIX=${scope}" "$summary"; then
    echo "ERROR: missing validator-files section for scope='${scope}'" >&2
    fail=1
    continue
  fi
  for name in validate-report.json validate-schema-assertion.txt; do
    # Must appear inside a markdown link label: [ ...`<name>`... ]( <url> )
    if ! grep -Eq "\[[^]]*\`${name}\`[^]]*\]\([^)]+\)" "$summary"; then
      echo "ERROR: no direct link for \`${name}\` in scope='${scope}' section" >&2
      fail=1
    fi
  done
done

if [ "$fail" -ne 0 ]; then
  echo "---- step summary (for debugging) ----" >&2
  sed 's/^/  /' "$summary" >&2
  exit 1
fi

echo "OK: step summary contains direct links to validate-report.json and validate-schema-assertion.txt for atomic + stress"
