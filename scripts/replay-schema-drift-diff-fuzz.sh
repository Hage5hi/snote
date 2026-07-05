#!/usr/bin/env bash
# replay-schema-drift-diff-fuzz.sh
#
# Replay the schema-drift-diff --json-out fuzz + concurrent-reader suite
# with a captured SCHEMA_DRIFT_DIFF_FUZZ_SEED (and optional reader window).
# Writes stdout, stderr, run manifest, a small env/test-context file, and
# a sha256 checksum file into a timestamped folder under
# ./artifacts/schema-drift-diff-replay/ so multiple replays don't stomp
# each other.
#
# Usage:
#   scripts/replay-schema-drift-diff-fuzz.sh <SEED> [READER_MS] [PATTERN]
#   scripts/replay-schema-drift-diff-fuzz.sh --from <CI-ARTIFACT-FOLDER>
#
# Examples:
#   scripts/replay-schema-drift-diff-fuzz.sh 12648430
#   scripts/replay-schema-drift-diff-fuzz.sh 12648430 2000 "fuzz: varied valid"
#   scripts/replay-schema-drift-diff-fuzz.sh --from ./downloaded-ci-artifact/20260705T110804Z-seed-42
#
# Env passthrough (all optional):
#   SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN — override the -t filter
#   SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS   — vitest --testTimeout value
set -euo pipefail

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,22p' "$0"
  exit 2
fi

# ---- (1) --from <folder>: read seed/reader/pattern/timeout from manifest,
# verify checksums against checksums.sha256, then dispatch back into this
# script with positional args so the normal replay path runs.
if [[ "$1" == "--from" ]]; then
  SRC="${2:?--from requires a folder path}"
  MANIFEST="$SRC/manifest.txt"
  SUMS="$SRC/checksums.sha256"
  [ -d "$SRC" ]      || { echo "--from: not a directory: $SRC" >&2; exit 8; }
  [ -r "$MANIFEST" ] || { echo "--from: missing/unreadable manifest: $MANIFEST" >&2; exit 8; }
  [ -r "$SUMS" ]     || { echo "--from: missing/unreadable checksums: $SUMS" >&2; exit 8; }
  echo "--from: verifying checksums in $SUMS" >&2
  ( cd "$SRC" && sha256sum -c checksums.sha256 ) >&2 \
    || { echo "--from: FAIL checksum mismatch in $SRC" >&2; exit 8; }
  # Parse `key: value` lines (whitespace-flex) from the manifest.
  extract() { awk -F: -v k="$1" '$1==k { sub(/^[^:]*:[ \t]*/, "", $0); print; exit }' "$MANIFEST"; }
  SEED_V="$(extract SCHEMA_DRIFT_DIFF_FUZZ_SEED)"
  READER_V="$(extract SCHEMA_DRIFT_DIFF_READER_DURATION_MS)"
  PATTERN_V="$(extract SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN)"
  TIMEOUT_V="$(extract SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS)"
  [ -n "$SEED_V" ] || { echo "--from: manifest missing SCHEMA_DRIFT_DIFF_FUZZ_SEED" >&2; exit 8; }
  echo "--from: replaying seed=$SEED_V reader_ms=$READER_V pattern='$PATTERN_V' timeout_ms=$TIMEOUT_V" >&2
  SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS="${TIMEOUT_V:-30000}" \
    exec "$0" "$SEED_V" "${READER_V:-300}" "${PATTERN_V:-concurrent reader \+ fuzz \+ unsafe symlink}"
fi

SEED="$1"
READER_MS="${2:-${SCHEMA_DRIFT_DIFF_READER_DURATION_MS:-300}}"
PATTERN="${3:-${SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:-concurrent reader \+ fuzz \+ unsafe symlink}}"
TIMEOUT_MS="${SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:-30000}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="artifacts/schema-drift-diff-replay/${TS}-seed-${SEED}"
mkdir -p "$OUT"

cat > "$OUT/manifest.txt" <<EOF
timestamp_utc:                          ${TS}
SCHEMA_DRIFT_DIFF_FUZZ_SEED:            ${SEED}
SCHEMA_DRIFT_DIFF_READER_DURATION_MS:   ${READER_MS}
SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:    ${PATTERN}
SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:      ${TIMEOUT_MS}
git_commit:                             $(git rev-parse HEAD 2>/dev/null || echo unknown)
node:                                   $(node --version 2>/dev/null || echo unknown)
bun:                                    $(bun --version 2>/dev/null || echo unknown)
EOF

# ---- (2) env/test-context sidecar. Captures every SCHEMA_DRIFT_DIFF_*
# knob plus CI test filters (VITEST_*, CI, GITHUB_*) so a contributor can
# replay under the same conditions the CI job used.
{
  echo "# schema-drift-diff replay env/test-context (source with: set -a; . env.sh; set +a)"
  echo "SCHEMA_DRIFT_DIFF_FUZZ_SEED=${SEED}"
  echo "SCHEMA_DRIFT_DIFF_READER_DURATION_MS=${READER_MS}"
  echo "SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN=${PATTERN}"
  echo "SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS=${TIMEOUT_MS}"
  env | grep -E '^(SCHEMA_DRIFT_DIFF_|VITEST_|CI=|GITHUB_(WORKFLOW|JOB|RUN_ID|RUN_ATTEMPT|REF|SHA)=|RUNNER_(OS|ARCH|TEMP)=)' \
      | LC_ALL=C sort -u || true
} > "$OUT/env.sh"

: > "$OUT/vitest.stdout.log"
: > "$OUT/vitest.stderr.log"

# ---- (3) checksums for pre-replay verification. Only immutable inputs
# (manifest + env sidecar) are hashed so `--from` can validate the folder
# no matter how many times it has been replayed. Log files are outputs —
# their post-run hashes go into `checksums.postrun.sha256` for provenance.
( cd "$OUT" && sha256sum manifest.txt env.sh > checksums.sha256 )


echo "replay -> $OUT" >&2
cat "$OUT/manifest.txt" >&2

# Pre-replay verification: manifest + env sidecar + checksums all present,
# readable, and (for the manifest/env files) checksum-valid.
verify() {
  local label="$1" path="$2"
  [ -e "$path" ] || { echo "pre-replay: FAIL $label missing: $path" >&2; exit 8; }
  [ -r "$path" ] || { echo "pre-replay: FAIL $label unreadable: $path" >&2; exit 8; }
  [ -s "$path" ] || { echo "pre-replay: FAIL $label is empty: $path" >&2; exit 8; }
  echo "pre-replay: OK   $label ($path)" >&2
}
verify "manifest"  "$OUT/manifest.txt"
verify "env.sh"    "$OUT/env.sh"
verify "checksums" "$OUT/checksums.sha256"
[ -w "$OUT/vitest.stdout.log" ] || { echo "pre-replay: FAIL stdout log not writable" >&2; exit 8; }
[ -w "$OUT/vitest.stderr.log" ] || { echo "pre-replay: FAIL stderr log not writable" >&2; exit 8; }
grep -q "^SCHEMA_DRIFT_DIFF_FUZZ_SEED:" "$OUT/manifest.txt" || {
  echo "pre-replay: FAIL manifest missing SCHEMA_DRIFT_DIFF_FUZZ_SEED line" >&2; exit 8;
}
( cd "$OUT" && sha256sum -c checksums.sha256 ) >/dev/null \
  || { echo "pre-replay: FAIL checksum mismatch in $OUT/checksums.sha256" >&2; exit 8; }
echo "pre-replay: OK   checksums verified" >&2

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
# Post-run checksums for the (now-populated) log files, appended so the
# pre-replay `--from` check against the frozen `checksums.sha256` still
# matches the empty-log baseline.
( cd "$OUT" && sha256sum vitest.stdout.log vitest.stderr.log > checksums.postrun.sha256 )
exit "$CODE"
