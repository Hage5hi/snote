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
#   scripts/replay-schema-drift-diff-fuzz.sh <SEED> [READER_MS] [PATTERN] [flags]
#   scripts/replay-schema-drift-diff-fuzz.sh --from <CI-ARTIFACT-FOLDER> [flags]
#
# Flags (may be combined with either form):
#   --dry-run                     Verify checksums/required files only, then
#                                 print the exact vitest command that would run.
#   --test-name-pattern <p>       Override vitest -t filter (beats env/manifest).
#   --print-manifest              Print manifest + derived seed/reader/pattern
#                                 in a readable format and exit 0. Use with
#                                 --from to inspect a CI artifact folder.
#
# Env passthrough (all optional):
#   SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN — override the -t filter
#   SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS   — vitest --testTimeout value
set -euo pipefail

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,27p' "$0"
  exit 2
fi

# ---- flag pre-parse: pull known flags from anywhere on the command line;
# leave the rest as positional args.
DRY_RUN=0
PRINT_MANIFEST=0
VERBOSE=0
JSON_SUMMARY=0
PATTERN_OVERRIDE=""
POSARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)             DRY_RUN=1; shift ;;
    --print-manifest)      PRINT_MANIFEST=1; shift ;;
    --verbose|-v)          VERBOSE=1; shift ;;
    --json-summary)        JSON_SUMMARY=1; shift ;;
    --test-name-pattern)   PATTERN_OVERRIDE="${2:?--test-name-pattern requires a value}"; shift 2 ;;
    --test-name-pattern=*) PATTERN_OVERRIDE="${1#*=}"; shift ;;
    *)                     POSARGS+=("$1"); shift ;;
  esac
done
set -- "${POSARGS[@]}"

vlog() { [[ "$VERBOSE" == "1" ]] && echo "verbose: $*" >&2 || true; }

# Small helper: pretty-print a manifest with derived fields.
print_manifest() {
  local m="$1"
  echo "== manifest: $m =="
  cat "$m"
  echo
  echo "-- derived --"
  awk -F: '
    /^SCHEMA_DRIFT_DIFF_FUZZ_SEED:/          { sub(/^[^:]*:[ \t]*/,""); print "seed          = " $0; next }
    /^SCHEMA_DRIFT_DIFF_READER_DURATION_MS:/ { sub(/^[^:]*:[ \t]*/,""); print "reader_ms     = " $0; next }
    /^SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:/  { sub(/^[^:]*:[ \t]*/,""); print "test_pattern  = " $0; next }
    /^SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:/    { sub(/^[^:]*:[ \t]*/,""); print "timeout_ms    = " $0; next }
  ' "$m"
}

# ---- (1) --from <folder>: read seed/reader/pattern/timeout from manifest,
# verify checksums against checksums.sha256, then dispatch back into this
# script with positional args so the normal replay path runs.
if [[ "${1:-}" == "--from" ]]; then
  SRC="${2:?--from requires a folder path}"
  MANIFEST="$SRC/manifest.txt"
  SUMS="$SRC/checksums.sha256"
  [ -d "$SRC" ]      || { echo "--from: not a directory: $SRC" >&2; exit 8; }
  [ -r "$MANIFEST" ] || { echo "--from: missing/unreadable manifest: $MANIFEST" >&2; exit 8; }
  [ -r "$SUMS" ]     || { echo "--from: missing/unreadable checksums: $SUMS" >&2; exit 8; }
  echo "--from: verifying checksums in $SUMS" >&2
  ( cd "$SRC" && sha256sum -c checksums.sha256 ) >&2 \
    || { echo "--from: FAIL checksum mismatch in $SRC" >&2; exit 8; }
  if [[ "$PRINT_MANIFEST" == "1" ]]; then
    print_manifest "$MANIFEST"
    exit 0
  fi
  extract() { awk -F: -v k="$1" '$1==k { sub(/^[^:]*:[ \t]*/, "", $0); print; exit }' "$MANIFEST"; }
  SEED_V="$(extract SCHEMA_DRIFT_DIFF_FUZZ_SEED)"
  READER_V="$(extract SCHEMA_DRIFT_DIFF_READER_DURATION_MS)"
  PATTERN_V="${PATTERN_OVERRIDE:-$(extract SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN)}"
  TIMEOUT_V="$(extract SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS)"
  [ -n "$SEED_V" ] || { echo "--from: manifest missing SCHEMA_DRIFT_DIFF_FUZZ_SEED" >&2; exit 8; }
  echo "--from: replaying seed=$SEED_V reader_ms=$READER_V pattern='$PATTERN_V' timeout_ms=$TIMEOUT_V" >&2
  FORWARD=()
  [[ "$DRY_RUN" == "1" ]] && FORWARD+=("--dry-run")
  SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS="${TIMEOUT_V:-30000}" \
    exec "$0" "$SEED_V" "${READER_V:-300}" "${PATTERN_V:-concurrent reader \+ fuzz \+ unsafe symlink}" "${FORWARD[@]}"
fi

SEED="${1:?SEED is required (or use --from <folder>)}"
READER_MS="${2:-${SCHEMA_DRIFT_DIFF_READER_DURATION_MS:-300}}"
PATTERN="${PATTERN_OVERRIDE:-${3:-${SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:-concurrent reader \+ fuzz \+ unsafe symlink}}}"
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

# ---- (2) env/test-context sidecar.
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

( cd "$OUT" && sha256sum manifest.txt env.sh > checksums.sha256 )

echo "replay -> $OUT" >&2
cat "$OUT/manifest.txt" >&2

# Pre-replay verification.
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
CHECKSUM_STATUS="ok"
if ! ( cd "$OUT" && sha256sum -c checksums.sha256 ) >/dev/null; then
  CHECKSUM_STATUS="mismatch"
  echo "pre-replay: FAIL checksum mismatch in $OUT/checksums.sha256" >&2
  exit 8
fi
echo "pre-replay: OK   checksums verified" >&2

[[ "$PRINT_MANIFEST" == "1" ]] && { print_manifest "$OUT/manifest.txt"; exit 0; }

# Assemble the exact command we would (or will) run — shared by dry-run + real run.
CMD=(bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts
     -t "$PATTERN"
     --testTimeout="$TIMEOUT_MS"
     --reporter=verbose)
printf 'command: SCHEMA_DRIFT_DIFF_FUZZ_SEED=%q SCHEMA_DRIFT_DIFF_READER_DURATION_MS=%q' "$SEED" "$READER_MS" >&2
printf ' %q' "${CMD[@]}" >&2
printf '\n' >&2

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run: verification complete, not executing vitest" >&2
  {
    echo "mode:                dry-run"
    echo "checksum_verified:   $CHECKSUM_STATUS"
    echo "would_run:           ${CMD[*]}"
    echo "seed:                $SEED"
    echo "reader_ms:           $READER_MS"
    echo "pattern:             $PATTERN"
    echo "timeout_ms:          $TIMEOUT_MS"
  } > "$OUT/replay-summary.txt"
  exit 0
fi

START_EPOCH=$(date +%s)
set +e
SCHEMA_DRIFT_DIFF_FUZZ_SEED="$SEED" \
SCHEMA_DRIFT_DIFF_READER_DURATION_MS="$READER_MS" \
  "${CMD[@]}" \
    > >(tee "$OUT/vitest.stdout.log") \
    2> >(tee "$OUT/vitest.stderr.log" >&2)
CODE=$?
set -e
END_EPOCH=$(date +%s)
DURATION=$(( END_EPOCH - START_EPOCH ))

echo "$CODE" > "$OUT/exit_code.txt"
echo "exit_code: $CODE (see $OUT/exit_code.txt)" >&2
( cd "$OUT" && sha256sum vitest.stdout.log vitest.stderr.log exit_code.txt > checksums.postrun.sha256 )

# ---- final replay summary sitting next to exit_code.txt.
{
  echo "mode:                run"
  echo "exit_code:           $CODE"
  echo "duration_seconds:    $DURATION"
  echo "checksum_verified:   $CHECKSUM_STATUS"
  echo "seed:                $SEED"
  echo "reader_ms:           $READER_MS"
  echo "pattern:             $PATTERN"
  echo "timeout_ms:          $TIMEOUT_MS"
  echo "stdout_log:          $OUT/vitest.stdout.log"
  echo "stderr_log:          $OUT/vitest.stderr.log"
  echo "postrun_checksums:   $OUT/checksums.postrun.sha256"
} > "$OUT/replay-summary.txt"
echo "summary -> $OUT/replay-summary.txt" >&2

exit "$CODE"
