#!/usr/bin/env bash
# replay-schema-drift-diff-fuzz.sh
#
# Replay the schema-drift-diff --json-out fuzz + concurrent-reader suite
# with a captured SCHEMA_DRIFT_DIFF_FUZZ_SEED (and optional reader window).
# Writes stdout, stderr, and the run manifest into a timestamped folder
# under ./artifacts/schema-drift-diff-replay/ so multiple replays don't
# stomp each other.
#
# Usage:
#   scripts/replay-schema-drift-diff-fuzz.sh <SEED> [READER_MS] [PATTERN]
#
# Examples:
#   scripts/replay-schema-drift-diff-fuzz.sh 12648430
#   scripts/replay-schema-drift-diff-fuzz.sh 12648430 2000
#   scripts/replay-schema-drift-diff-fuzz.sh 12648430 2000 "fuzz: varied valid"
#
# Env passthrough (all optional):
#   SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN — override the -t filter
#   SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS  — vitest --test-timeout value
set -euo pipefail

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,20p' "$0"
  exit 2
fi

SEED="$1"
READER_MS="${2:-${SCHEMA_DRIFT_DIFF_READER_DURATION_MS:-300}}"
PATTERN="${3:-${SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:-concurrent reader \+ fuzz \+ unsafe symlink}}"
TIMEOUT_MS="${SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:-30000}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="artifacts/schema-drift-diff-replay/${TS}-seed-${SEED}"
mkdir -p "$OUT"

cat > "$OUT/manifest.txt" <<EOF
timestamp_utc:            ${TS}
SCHEMA_DRIFT_DIFF_FUZZ_SEED:            ${SEED}
SCHEMA_DRIFT_DIFF_READER_DURATION_MS:   ${READER_MS}
SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:    ${PATTERN}
SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:      ${TIMEOUT_MS}
git_commit:               $(git rev-parse HEAD 2>/dev/null || echo unknown)
node:                     $(node --version 2>/dev/null || echo unknown)
bun:                      $(bun --version 2>/dev/null || echo unknown)
EOF

echo "replay -> $OUT" >&2
cat "$OUT/manifest.txt" >&2

set +e
SCHEMA_DRIFT_DIFF_FUZZ_SEED="$SEED" \
SCHEMA_DRIFT_DIFF_READER_DURATION_MS="$READER_MS" \
  bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts \
    -t "$PATTERN" \
    --testTimeout="$TIMEOUT_MS" \
    --reporter=verbose \
    > >(tee "$OUT/vitest.stdout.log") \
    2> >(tee "$OUT/vitest.stderr.log" >&2)
CODE=$?
set -e

echo "exit_code: $CODE" | tee -a "$OUT/manifest.txt"
exit "$CODE"
