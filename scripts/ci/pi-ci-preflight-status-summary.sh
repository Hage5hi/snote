#!/usr/bin/env bash
# Append a preflight-status section to $GITHUB_STEP_SUMMARY for the
# pretty-index-mismatch-ci scope AND write the same Markdown to
# <out-dir>/preflight-status.md for artifact upload. Lists per-file
# status (OK / MISSING / EMPTY) with the exact paths so a reviewer can
# debug the failing matrix run without downloading the full bundle.
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
status_file="${PI_CI_PREFLIGHT_STATUS_PATH:-$out/preflight-status.md}"
annotate="${PI_CI_PREFLIGHT_ANNOTATIONS:-}"

mkdir -p "$out" "$(dirname -- "$status_file")" 2>/dev/null || true

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

emit_annotation() {
  local label="$1"
  local status="$2"
  local path="$3"
  case "$annotate" in
    1|true|TRUE|yes|YES)
      if [ "$status" != "OK" ]; then
        echo "::error file=${path}::preflight: ${label} ${status}"
      fi
      ;;
  esac
}

body="$status_file.tmp.$$"
rm -f -- "$body"
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
  echo "_content_hash: ${vr_status}:${vsa_status}_"
} > "$body" 2>/dev/null || true


emit_annotation "validate-report.json" "$vr_status" "$vr"
emit_annotation "validate-schema-assertion.txt" "$vsa_status" "$vsa"

cat "$body" > "$status_file" 2>/dev/null || true
if [ "$sink" != "$status_file" ]; then
  cat "$body" >> "$sink" 2>/dev/null || true
fi
rm -f -- "$body" 2>/dev/null || true

# JSON sidecar with content_hash for CI diffing across runs.
json_file="${status_file%.md}.json"
hash_input="vr=${vr_status}:$( [ -f "$vr" ] && wc -c < "$vr" | tr -d ' ' || echo 0 );vsa=${vsa_status}:$( [ -f "$vsa" ] && wc -c < "$vsa" | tr -d ' ' || echo 0 )"
if command -v sha256sum >/dev/null 2>&1; then
  content_hash="sha256:$(printf '%s' "$hash_input" | sha256sum | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  content_hash="sha256:$(printf '%s' "$hash_input" | shasum -a 256 | awk '{print $1}')"
else
  content_hash="none:unavailable"
fi
printf '{"schema":"pi-ci/preflight-status/v1","scope":"%s","validate_report":{"status":"%s","path":"%s"},"validate_schema_assertion":{"status":"%s","path":"%s"},"content_hash":"%s"}\n' \
  "$scope" "$vr_status" "$vr" "$vsa_status" "$vsa" "$content_hash" \
  > "$json_file" 2>/dev/null || true

exit 0

