#!/usr/bin/env bash
# Rerun the rename stress test using the exact STRESS_RENAME_SEED /
# STRESS_RENAME_ITERATIONS captured in a prior Playwright HTML report.
#
# Usage:
#   scripts/rerun-stress-from-report.sh [path/to/playwright-report-or-test-results]
#
# Defaults to ./playwright-report then ./test-results. Extracts the first
# `stress-seed.json` attachment it finds and re-invokes the stress spec with
# the same seed + iteration count so failures replay deterministically.
set -euo pipefail

ROOT="${1:-}"
if [[ -z "${ROOT}" ]]; then
  for c in playwright-report test-results; do
    if [[ -d "$c" ]]; then ROOT="$c"; break; fi
  done
fi
if [[ -z "${ROOT}" || ! -d "${ROOT}" ]]; then
  echo "usage: $0 <playwright-report-dir|test-results-dir>" >&2
  exit 2
fi

SEED_FILE="$(find "$ROOT" -type f -name 'stress-seed*.json' | head -n1 || true)"
if [[ -z "$SEED_FILE" ]]; then
  echo "no stress-seed*.json attachment found under $ROOT" >&2
  exit 3
fi
echo "[rerun-stress] using $SEED_FILE"

SEED="$(node -e "const j=require('fs').readFileSync(process.argv[1],'utf8');const o=JSON.parse(j);process.stdout.write(String(o.seed));" "$SEED_FILE")"
ITER="$(node -e "const j=require('fs').readFileSync(process.argv[1],'utf8');const o=JSON.parse(j);process.stdout.write(String(o.iterations));" "$SEED_FILE")"
CI_FLAG="$(node -e "const j=require('fs').readFileSync(process.argv[1],'utf8');const o=JSON.parse(j);process.stdout.write(o.ci?'1':'');" "$SEED_FILE")"

export STRESS_RENAME_SEED="$SEED"
export STRESS_RENAME_ITERATIONS="$ITER"
[[ -n "$CI_FLAG" ]] && export CI="$CI_FLAG"

echo "[rerun-stress] STRESS_RENAME_SEED=$STRESS_RENAME_SEED STRESS_RENAME_ITERATIONS=$STRESS_RENAME_ITERATIONS CI=${CI:-}"
exec bunx playwright test e2e/note-rename-yjs-race.spec.ts \
  -g "stress: repeated randomized-debounce renames never resurrect old slugs" \
  "$@"
