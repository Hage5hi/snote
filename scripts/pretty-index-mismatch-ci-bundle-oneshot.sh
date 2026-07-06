#!/usr/bin/env bash
# One-shot local wrapper: download the pretty-index-mismatch-ci bundle
# from a GitHub Actions run, print the extracted listing, then re-run
# the strict schema check. Composes three existing Makefile targets so
# there's a single command to reach for when triaging a CI failure.
#
# Usage:
#   scripts/pretty-index-mismatch-ci-bundle-oneshot.sh <RUN_ID> \
#       [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]
#
# Examples:
#   scripts/pretty-index-mismatch-ci-bundle-oneshot.sh 1234567890
#   scripts/pretty-index-mismatch-ci-bundle-oneshot.sh 1234567890 stress
#   scripts/pretty-index-mismatch-ci-bundle-oneshot.sh 1234567890 atomic macos-latest
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <RUN_ID> [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]" >&2
  exit 2
fi

RUN_ID="$1"
PI_CI_SCOPE="${2:-atomic}"
OS="${3:-ubuntu-latest}"

echo "==> [1/3] downloading bundle (RUN_ID=$RUN_ID PI_CI_SCOPE=$PI_CI_SCOPE OS=$OS)"
make -s pretty-index-mismatch-ci-bundle-download \
  RUN_ID="$RUN_ID" PI_CI_SCOPE="$PI_CI_SCOPE" OS="$OS"

echo
echo "==> [2/3] listing extracted bundle"
make -s pretty-index-mismatch-ci-bundle-list PI_CI_SCOPE="$PI_CI_SCOPE"

echo
echo "==> [3/3] re-running validator schema check"
make -s pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE="$PI_CI_SCOPE"
