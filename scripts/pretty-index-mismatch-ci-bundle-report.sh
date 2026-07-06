#!/usr/bin/env bash
# One-command local triage helper: download a pretty-index-mismatch-ci
# bundle artifact, then generate the same preflight-status Markdown and
# extracted-tree manifest files CI uploads.
#
# Usage:
#   scripts/pretty-index-mismatch-ci-bundle-report.sh <RUN_ID> \
#       [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <RUN_ID> [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]" >&2
  exit 2
fi

RUN_ID="$1"
PI_CI_SCOPE="${2:-atomic}"
OS="${3:-ubuntu-latest}"

case "$PI_CI_SCOPE" in
  atomic|stress) ;;
  *) echo "ERROR: PI_CI_SCOPE must be 'atomic' or 'stress' (got '$PI_CI_SCOPE')" >&2; exit 2 ;;
esac

bundle_dir="./_pi-ci-bundle-$PI_CI_SCOPE"
extracted_out="$bundle_dir/extracted/pi-ci-$PI_CI_SCOPE"
status_file="$extracted_out/preflight-status.md"
manifest_file="$extracted_out/extracted-tree.txt"

echo "==> [1/3] downloading bundle (RUN_ID=$RUN_ID PI_CI_SCOPE=$PI_CI_SCOPE OS=$OS)"
set +e
make -s pretty-index-mismatch-ci-bundle-download \
  RUN_ID="$RUN_ID" PI_CI_SCOPE="$PI_CI_SCOPE" OS="$OS"
download_rc=$?
set -e

mkdir -p "$extracted_out"

echo
echo "==> [2/3] writing preflight status table"
GITHUB_STEP_SUMMARY="$status_file" \
PI_CI_PREFLIGHT_STATUS_PATH="$status_file" \
  scripts/ci/pi-ci-preflight-status-summary.sh "$extracted_out" "$PI_CI_SCOPE"
cat "$status_file" 2>/dev/null || true

echo
echo "==> [3/3] writing extracted-tree manifest"
scripts/ci/pi-ci-extracted-tree-manifest.sh "$extracted_out" >/dev/null
cat "$manifest_file" 2>/dev/null || true

echo
echo "preflight status : $status_file"
echo "extracted tree   : $manifest_file"

if [ "$download_rc" -ne 0 ]; then
  echo "download/extract step exited $download_rc; reports above were still generated" >&2
fi
exit "$download_rc"