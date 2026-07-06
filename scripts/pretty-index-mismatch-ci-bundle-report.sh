#!/usr/bin/env bash
# One-command local triage helper: download (or reuse) a pretty-index-
# mismatch-ci bundle artifact, regenerate the same preflight-status +
# extracted-tree sidecars CI uploads, and print a single consolidated
# summary that includes the exact content_hash of each report + the
# absolute output file paths.
#
# Usage:
#   scripts/pretty-index-mismatch-ci-bundle-report.sh <RUN_ID> [PI_CI_SCOPE] [OS]
#   scripts/pretty-index-mismatch-ci-bundle-report.sh --dir <artifacts-dir> [PI_CI_SCOPE]
#
# Examples:
#   scripts/pretty-index-mismatch-ci-bundle-report.sh 1234567890 atomic
#   scripts/pretty-index-mismatch-ci-bundle-report.sh --dir ./_pi-ci-bundle-atomic/extracted/pi-ci-atomic
set -euo pipefail

usage() {
  echo "usage: $0 <RUN_ID> [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]" >&2
  echo "       $0 --dir <artifacts-dir> [PI_CI_SCOPE=atomic|stress]" >&2
  exit 2
}

[ $# -ge 1 ] || usage

MODE="download"
ARTIFACTS_DIR=""
RUN_ID=""
if [ "$1" = "--dir" ]; then
  MODE="dir"
  ARTIFACTS_DIR="${2:-}"
  [ -n "$ARTIFACTS_DIR" ] || usage
  PI_CI_SCOPE="${3:-atomic}"
  OS="${4:-ubuntu-latest}"
else
  RUN_ID="$1"
  PI_CI_SCOPE="${2:-atomic}"
  OS="${3:-ubuntu-latest}"
fi

case "$PI_CI_SCOPE" in atomic|stress) ;;
  *) echo "ERROR: PI_CI_SCOPE must be 'atomic' or 'stress' (got '$PI_CI_SCOPE')" >&2; exit 2 ;;
esac

download_rc=0
if [ "$MODE" = "download" ]; then
  echo "==> [1/4] downloading bundle (RUN_ID=$RUN_ID PI_CI_SCOPE=$PI_CI_SCOPE OS=$OS)"
  set +e
  make -s pretty-index-mismatch-ci-bundle-download \
    RUN_ID="$RUN_ID" PI_CI_SCOPE="$PI_CI_SCOPE" OS="$OS"
  download_rc=$?
  set -e
  ARTIFACTS_DIR="./_pi-ci-bundle-$PI_CI_SCOPE/extracted/pi-ci-$PI_CI_SCOPE"
else
  echo "==> [1/4] using existing artifacts dir: $ARTIFACTS_DIR"
fi

extracted_out="$ARTIFACTS_DIR"
status_md="$extracted_out/preflight-status.md"
status_json="$extracted_out/preflight-status.json"
manifest_txt="$extracted_out/extracted-tree.txt"
manifest_json="$extracted_out/extracted-tree.json"
mkdir -p "$extracted_out"

echo
echo "==> [2/4] writing preflight status table"
GITHUB_STEP_SUMMARY="$status_md" \
PI_CI_PREFLIGHT_STATUS_PATH="$status_md" \
  scripts/ci/pi-ci-preflight-status-summary.sh "$extracted_out" "$PI_CI_SCOPE"

echo
echo "==> [3/4] writing extracted-tree manifest"
scripts/ci/pi-ci-extracted-tree-manifest.sh "$extracted_out" >/dev/null

echo
echo "==> [4/4] schema-checking report sidecars"
schema_rc=0
scripts/ci/pi-ci-validate-report-schemas.sh "$extracted_out" || schema_rc=$?

hash_of() {
  local f="$1"
  [ -s "$f" ] || { echo "MISSING"; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r '.content_hash // "n/a"' -- "$f" 2>/dev/null || echo "n/a"
  else
    grep -o '"content_hash":"[^"]*"' "$f" | head -1 | sed 's/.*:"\(.*\)"/\1/'
  fi
}
sv_of() {
  local f="$1"
  [ -s "$f" ] || { echo "MISSING"; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r '(.schema_version // "<missing>") | tostring' -- "$f" 2>/dev/null || echo "n/a"
  else
    echo "n/a"
  fi
}

EXPECTED_SV="1"
sv_status() {
  local actual="$1"
  if [ "$actual" = "$EXPECTED_SV" ]; then echo "OK"; else echo "MISMATCH"; fi
}
tree_sv="$(sv_of "$manifest_json")"
pre_sv="$(sv_of "$status_json")"

echo
echo "── pretty-index-mismatch-ci consolidated report ──"
echo "  scope                : $PI_CI_SCOPE"
echo "  artifacts dir        : $extracted_out"
echo "  preflight status hash: $(hash_of "$status_json")"
echo "  extracted tree  hash : $(hash_of "$manifest_json")"
echo "  preflight status (md)   : $status_md"
echo "  preflight status (json) : $status_json"
echo "  extracted tree   (txt)  : $manifest_txt"
echo "  extracted tree   (json) : $manifest_json"
echo "  schema check exit       : $schema_rc"
echo
echo "── schema_version (expected=$EXPECTED_SV) ──"
printf "  %-24s  actual=%-10s  status=%-8s  file=%s\n" "extracted-tree.json"  "$tree_sv" "$(sv_status "$tree_sv")" "$manifest_json"
printf "  %-24s  actual=%-10s  status=%-8s  file=%s\n" "preflight-status.json" "$pre_sv"  "$(sv_status "$pre_sv")"  "$status_json"

if [ "$download_rc" -ne 0 ]; then
  echo "note: download/extract step exited $download_rc; reports above were still generated" >&2
fi

# Prefer surfacing a real failure (schema drift) over the download rc so
# CI/local users fail fast on format drift, per the reporting contract.
if [ "$schema_rc" -ne 0 ]; then
  exit "$schema_rc"
fi
exit "$download_rc"
