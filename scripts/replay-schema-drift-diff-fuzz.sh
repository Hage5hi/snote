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
OUTPUT_DIR_OVERRIDE=""
POSARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)             DRY_RUN=1; shift ;;
    --print-manifest)      PRINT_MANIFEST=1; shift ;;
    --verbose|-v)          VERBOSE=1; shift ;;
    --json-summary)        JSON_SUMMARY=1; shift ;;
    --test-name-pattern)   PATTERN_OVERRIDE="${2:?--test-name-pattern requires a value}"; shift 2 ;;
    --test-name-pattern=*) PATTERN_OVERRIDE="${1#*=}"; shift ;;
    --output-dir)          OUTPUT_DIR_OVERRIDE="${2:?--output-dir requires a value}"; shift 2 ;;
    --output-dir=*)        OUTPUT_DIR_OVERRIDE="${1#*=}"; shift ;;
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
  if [[ "$VERBOSE" == "1" ]]; then
    echo "verbose: --from folder=$SRC" >&2
    echo "verbose: required files:" >&2
    for f in manifest.txt env.sh checksums.sha256; do
      if [ -e "$SRC/$f" ]; then
        echo "verbose:   [OK]      $SRC/$f ($(wc -c <"$SRC/$f") bytes)" >&2
      else
        echo "verbose:   [MISSING] $SRC/$f" >&2
      fi
    done
    echo "verbose: manifest entries -> required files mapping:" >&2
    echo "verbose:   SCHEMA_DRIFT_DIFF_FUZZ_SEED            -> positional \$1 (SEED)" >&2
    echo "verbose:   SCHEMA_DRIFT_DIFF_READER_DURATION_MS   -> positional \$2 (READER_MS)" >&2
    echo "verbose:   SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN    -> positional \$3 (vitest -t)" >&2
    echo "verbose:   SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS      -> env passthrough (vitest --testTimeout)" >&2
  fi
  echo "--from: verifying checksums in $SUMS" >&2
  set +e
  SUMS_OUT="$(cd "$SRC" && sha256sum -c checksums.sha256 2>&1)"; SUMS_RC=$?
  set -e
  printf '%s\n' "$SUMS_OUT" >&2
  if [[ $SUMS_RC -ne 0 ]]; then
    echo "--from: FAIL checksum mismatch in $SRC" >&2
    if [[ "$VERBOSE" == "1" ]]; then
      echo "verbose: failing entries (from sha256sum -c):" >&2
      printf '%s\n' "$SUMS_OUT" | grep -Ev ': OK$' | sed 's/^/verbose:   /' >&2
    fi
    exit 8
  fi
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
  [[ "$DRY_RUN" == "1" ]]      && FORWARD+=("--dry-run")
  [[ "$VERBOSE" == "1" ]]      && FORWARD+=("--verbose")
  [[ "$JSON_SUMMARY" == "1" ]] && FORWARD+=("--json-summary")
  [[ -n "$OUTPUT_DIR_OVERRIDE" ]] && FORWARD+=("--output-dir" "$OUTPUT_DIR_OVERRIDE")
  SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS="${TIMEOUT_V:-30000}" \
    exec "$0" "$SEED_V" "${READER_V:-300}" "${PATTERN_V:-concurrent reader \+ fuzz \+ unsafe symlink}" "${FORWARD[@]}"
fi


SEED="${1:?SEED is required (or use --from <folder>)}"
READER_MS="${2:-${SCHEMA_DRIFT_DIFF_READER_DURATION_MS:-300}}"
PATTERN="${PATTERN_OVERRIDE:-${3:-${SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN:-concurrent reader \+ fuzz \+ unsafe symlink}}}"
TIMEOUT_MS="${SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS:-30000}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUTPUT_DIR_OVERRIDE:-artifacts/schema-drift-diff-replay/${TS}-seed-${SEED}}"

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
# Pre-replay verification. Missing/unreadable/empty files are tracked in
# MISSING_FILES so the JSON summary can enumerate exactly what broke.
MISSING_FILES=()
FAIL_REASON=""
verify() {
  local label="$1" path="$2"
  vlog "verify: $label -> $path"
  if [ ! -e "$path" ]; then
    MISSING_FILES+=("$path")
    FAIL_REASON="$label missing: $path"
    echo "pre-replay: FAIL $label missing: $path" >&2
    [[ "$VERBOSE" == "1" ]] && echo "verbose:   parent=$(dirname "$path") ls: $(ls -la "$(dirname "$path")" 2>/dev/null | tr '\n' '|' )" >&2
    exit 8
  fi
  if [ ! -r "$path" ]; then
    MISSING_FILES+=("$path")
    FAIL_REASON="$label unreadable: $path"
    echo "pre-replay: FAIL $label unreadable: $path" >&2
    exit 8
  fi
  if [ ! -s "$path" ]; then
    MISSING_FILES+=("$path")
    FAIL_REASON="$label empty: $path"
    echo "pre-replay: FAIL $label is empty: $path" >&2
    exit 8
  fi
  echo "pre-replay: OK   $label ($path)" >&2
}
verify "manifest"  "$OUT/manifest.txt"
verify "env.sh"    "$OUT/env.sh"
verify "checksums" "$OUT/checksums.sha256"
[ -w "$OUT/vitest.stdout.log" ] || { echo "pre-replay: FAIL stdout log not writable" >&2; exit 8; }
[ -w "$OUT/vitest.stderr.log" ] || { echo "pre-replay: FAIL stderr log not writable" >&2; exit 8; }
grep -q "^SCHEMA_DRIFT_DIFF_FUZZ_SEED:" "$OUT/manifest.txt" || {
  FAIL_REASON="manifest missing SCHEMA_DRIFT_DIFF_FUZZ_SEED line"
  echo "pre-replay: FAIL $FAIL_REASON" >&2; exit 8;
}
CHECKSUM_STATUS="ok"
set +e; CHECKSUM_OUT="$(cd "$OUT" && sha256sum -c checksums.sha256 2>&1)"; CHECKSUM_RC=$?; set -e
if [[ $CHECKSUM_RC -ne 0 ]]; then
  CHECKSUM_STATUS="mismatch"
  FAIL_REASON="checksum mismatch in $OUT/checksums.sha256"
  echo "pre-replay: FAIL $FAIL_REASON" >&2
  printf '%s\n' "$CHECKSUM_OUT" >&2
  if [[ "$VERBOSE" == "1" ]]; then
    echo "verbose: failing checksum entries:" >&2
    printf '%s\n' "$CHECKSUM_OUT" | grep -Ev ': OK$' | sed 's/^/verbose:   /' >&2
  fi
  exit 8
fi
echo "pre-replay: OK   checksums verified" >&2
if [[ "$VERBOSE" == "1" ]]; then
  echo "verbose: manifest entries mapped to required files:" >&2
  echo "verbose:   manifest.txt        <- required (source of seed/reader/pattern/timeout)" >&2
  echo "verbose:   env.sh              <- required (env passthrough for reproducibility)" >&2
  echo "verbose:   checksums.sha256    <- required (integrity of manifest.txt + env.sh)" >&2
  echo "verbose:   vitest.stdout.log   <- writable placeholder (populated on real run)" >&2
  echo "verbose:   vitest.stderr.log   <- writable placeholder (populated on real run)" >&2
fi

[[ "$PRINT_MANIFEST" == "1" ]] && { print_manifest "$OUT/manifest.txt"; exit 0; }

# Assemble the exact command we would (or will) run — shared by dry-run + real run.
CMD=(bunx vitest run scripts/__tests__/schema-drift-pr-comment.test.ts
     -t "$PATTERN"
     --testTimeout="$TIMEOUT_MS"
     --reporter=verbose)
printf 'command: SCHEMA_DRIFT_DIFF_FUZZ_SEED=%q SCHEMA_DRIFT_DIFF_READER_DURATION_MS=%q' "$SEED" "$READER_MS" >&2
printf ' %q' "${CMD[@]}" >&2
printf '\n' >&2

# Emit a JSON summary next to replay-summary.txt when --json-summary is set.
# Uses jq if available (safe quoting for arbitrary pattern strings); falls
# back to a hand-rolled writer that escapes backslashes and double quotes.
write_json_summary() {
  local mode="$1" code="$2" duration="$3"
  [[ "$JSON_SUMMARY" == "1" ]] || return 0
  local dest="$OUT/replay-summary.json"
  if command -v jq >/dev/null 2>&1; then
    local mapping_json='[]'
    if [[ "$VERBOSE" == "1" ]]; then
      mapping_json=$(jq -n \
        --arg folder "$OUT" \
        '[
           {manifest_entry:"SCHEMA_DRIFT_DIFF_FUZZ_SEED",          required_file:($folder+"/manifest.txt"), role:"source of seed"},
           {manifest_entry:"SCHEMA_DRIFT_DIFF_READER_DURATION_MS", required_file:($folder+"/manifest.txt"), role:"source of reader window ms"},
           {manifest_entry:"SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN",  required_file:($folder+"/manifest.txt"), role:"source of vitest -t filter"},
           {manifest_entry:"SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS",    required_file:($folder+"/manifest.txt"), role:"source of vitest --testTimeout"},
           {manifest_entry:"(env passthrough)",                    required_file:($folder+"/env.sh"),      role:"env vars sourced before replay"},
           {manifest_entry:"(integrity)",                          required_file:($folder+"/checksums.sha256"), role:"sha256 of manifest.txt + env.sh"}
         ]')
    fi
    jq -n \
      --arg   mode      "$mode" \
      --argjson exit_code "${code:-null}" \
      --argjson duration_seconds "${duration:-null}" \
      --arg   checksum  "$CHECKSUM_STATUS" \
      --arg   seed      "$SEED" \
      --arg   reader_ms "$READER_MS" \
      --arg   pattern   "$PATTERN" \
      --arg   timeout_ms "$TIMEOUT_MS" \
      --argjson missing_files "$(printf '%s\n' "${MISSING_FILES[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
      --arg   fail_reason "$FAIL_REASON" \
      --arg   folder    "$OUT" \
      --argjson manifest_mapping "$mapping_json" \
      '{mode:$mode, exit_code:$exit_code, duration_seconds:$duration_seconds,
        checksum_verified:$checksum, seed:$seed, reader_ms:$reader_ms,
        pattern:$pattern, timeout_ms:$timeout_ms,
        missing_files:$missing_files, fail_reason:$fail_reason, folder:$folder,
        manifest_mapping:$manifest_mapping}' \
      > "$dest"

  else
    esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
    local missing_json="[]"
    if [[ ${#MISSING_FILES[@]} -gt 0 ]]; then
      missing_json="["
      local first=1 f
      for f in "${MISSING_FILES[@]}"; do
        [[ $first -eq 1 ]] || missing_json+=","
        missing_json+="\"$(esc "$f")\""
        first=0
      done
      missing_json+="]"
    fi
    local ec="${code:-null}" du="${duration:-null}"
    local mapping_json='[]'
    if [[ "$VERBOSE" == "1" ]]; then
      mapping_json="[
        {\"manifest_entry\":\"SCHEMA_DRIFT_DIFF_FUZZ_SEED\",\"required_file\":\"$(esc "$OUT/manifest.txt")\",\"role\":\"source of seed\"},
        {\"manifest_entry\":\"SCHEMA_DRIFT_DIFF_READER_DURATION_MS\",\"required_file\":\"$(esc "$OUT/manifest.txt")\",\"role\":\"source of reader window ms\"},
        {\"manifest_entry\":\"SCHEMA_DRIFT_DIFF_TEST_NAME_PATTERN\",\"required_file\":\"$(esc "$OUT/manifest.txt")\",\"role\":\"source of vitest -t filter\"},
        {\"manifest_entry\":\"SCHEMA_DRIFT_DIFF_TEST_TIMEOUT_MS\",\"required_file\":\"$(esc "$OUT/manifest.txt")\",\"role\":\"source of vitest --testTimeout\"},
        {\"manifest_entry\":\"(env passthrough)\",\"required_file\":\"$(esc "$OUT/env.sh")\",\"role\":\"env vars sourced before replay\"},
        {\"manifest_entry\":\"(integrity)\",\"required_file\":\"$(esc "$OUT/checksums.sha256")\",\"role\":\"sha256 of manifest.txt + env.sh\"}
      ]"
    fi
    cat > "$dest" <<JSON
{
  "mode": "$(esc "$mode")",
  "exit_code": ${ec},
  "duration_seconds": ${du},
  "checksum_verified": "$(esc "$CHECKSUM_STATUS")",
  "seed": "$(esc "$SEED")",
  "reader_ms": "$(esc "$READER_MS")",
  "pattern": "$(esc "$PATTERN")",
  "timeout_ms": "$(esc "$TIMEOUT_MS")",
  "missing_files": ${missing_json},
  "fail_reason": "$(esc "$FAIL_REASON")",
  "folder": "$(esc "$OUT")",
  "manifest_mapping": ${mapping_json}
}
JSON
  fi
  echo "json summary -> $dest" >&2
}

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
  write_json_summary "dry-run" "" ""
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
write_json_summary "run" "$CODE" "$DURATION"

exit "$CODE"
