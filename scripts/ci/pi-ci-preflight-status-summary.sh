#!/usr/bin/env bash
# Append a preflight-status section to $GITHUB_STEP_SUMMARY for the
# pretty-index-mismatch-ci scope. Lists per-file status (OK / MISSING /
# EMPTY) with the exact absolute paths so a reviewer can debug the
# failing matrix run without downloading any artifact bundle.
#
# Usage:
#   scripts/ci/pi-ci-preflight-status-summary.sh <out-dir> <scope>
#
# Always exits 0 — this is a reporting step; the real gating lives in
# the Makefile preflight and scripts/ci/assert-pi-ci-summary-links.sh.
set -u

out="${1:?usage: $0 <out-dir> <scope>}"
scope="${2:?usage: $0 <out-dir> <scope>}"
sink="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

status_for() {
  local p="$1"
  if [ ! -e "$p" ]; then echo "MISSING"
  elif [ ! -s "$p" ]; then echo "EMPTY"
  else echo "OK"
  fi
}

vr="$out/validate-report.json"
vsa="$out/validate-schema-assertion.txt"
vr_status=$(status_for "$vr")
vsa_status=$(status_for "$vsa")

{
  echo ""
  echo "### pretty-index-mismatch-ci preflight status — \`${scope}\`"
  echo ""
  echo "| file | status | path |"
  echo "|---|---|---|"
  echo "| validate-report.json | ${vr_status} | \`${vr}\` |"
  echo "| validate-schema-assertion.txt | ${vsa_status} | \`${vsa}\` |"
  echo ""
  if [ "$vr_status" != "OK" ] || [ "$vsa_status" != "OK" ]; then
    echo "_Non-OK entries above indicate the preflight would fail locally. Re-run \`make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=${scope}\` to reproduce._"
    echo ""
  fi
} >> "$sink" 2>/dev/null || true
exit 0
