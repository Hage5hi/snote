#!/usr/bin/env bash
# Run schema checks for BOTH extracted-tree.json and preflight-status.json
# in one shot. Used by CI + local Makefile so E2E / repro fails fast on
# report format drift. On failure, writes captured jq/schema error output
# to <out-dir>/report-schema-errors.txt (dedicated artifact upload path)
# and emits a GitHub Actions ::error annotation pointing at the bad file.
#
# Also writes <out-dir>/report-schema-validation-summary.json — a
# machine-readable summary of expected/actual schema_version, per-file
# status, and file paths — for CI parsers and follow-up tooling.
#
# Usage:
#   scripts/ci/pi-ci-validate-report-schemas.sh <out-dir>
#
# Exits non-zero if either schema check fails.
set -u
set -o pipefail

out="${1:?usage: $0 <out-dir>}"
here="$(cd -- "$(dirname -- "$0")" && pwd)"
mf="$out/extracted-tree.json"
pf="$out/preflight-status.json"
errfile="$out/report-schema-errors.txt"
summary="$out/report-schema-validation-summary.json"

# Ensure the summary artifact directory exists FIRST so we can always
# emit a minimal summary — even on the early-exit bad-env-var path.
mkdir -p "$out" 2>/dev/null || true

# Validate configurable expected schema_version. Non-integer or empty
# values fail fast with a clear error — CI + local users get a real
# signal instead of every check silently reporting "expected=<garbage>".
EXPECTED_SV="${PI_CI_EXPECTED_SCHEMA_VERSION-1}"
if ! printf '%s' "$EXPECTED_SV" | grep -Eq '^[0-9]+$'; then
  echo "ERROR: PI_CI_EXPECTED_SCHEMA_VERSION must be a non-empty integer (got: '${EXPECTED_SV}')" >&2
  # Minimal summary so CI's always-upload step still has something to
  # attach — downstream parsers can key off reason="bad-env-var".
  printf '{"schema":"pi-ci/report-schema-validation-summary/v1","expected_schema_version":"%s","out_dir":"%s","terminated_by":null,"files":[],"exit":2,"reason":"bad-env-var"}\n' \
    "$EXPECTED_SV" "$out" > "$summary" 2>/dev/null || true
  exit 2
fi
export PI_CI_EXPECTED_SCHEMA_VERSION="$EXPECTED_SV"

: > "$errfile"

# Always print the configured expected schema_version FIRST so it lands
# at the top of report-schema-validation-log.txt (CI tees stdout into
# it), even when jq/schema parsing fails or the process is killed.
echo "pi-ci-validate-report-schemas: expected schema_version=${EXPECTED_SV}"
echo "pi-ci-validate-report-schemas: out-dir=${out}"

# On any abnormal termination (signal, timeout, jq crash), always
# leave a "termination reason" line in the log AND a minimal summary
# JSON so the uploaded artifact is still useful for triage. The two
# header echoes above are guaranteed by shell buffering flush.
finalized=0
finalize_signal() {
  local sig="$1"
  [ "$finalized" = 1 ] && return 0
  echo "pi-ci-validate-report-schemas: terminated by ${sig} — expected schema_version=${EXPECTED_SV}"
  # Best-effort minimal summary if we didn't reach the normal writer.
  if [ ! -s "$summary" ]; then
    printf '{"schema":"pi-ci/report-schema-validation-summary/v1","expected_schema_version":"%s","out_dir":"%s","terminated_by":"%s","exit":null,"files":[],"reason":"terminated"}\n' \
      "$EXPECTED_SV" "$out" "$sig" > "$summary" 2>/dev/null || true
  fi
}
trap 'finalize_signal SIGTERM; exit 143' TERM
trap 'finalize_signal SIGINT;  exit 130' INT
trap 'finalize_signal SIGHUP;  exit 129' HUP

# Per-file state captured for the JSON summary. Parallel arrays keep
# this pure-bash (no jq dependency for writing the summary itself).
labels=()
paths=()
actuals=()
statuses=()
exits=()
reasons=()

rc=0
run_check() {
  local label="$1" script="$2" target="$3"
  echo "── $label ($target) ──" >> "$errfile"

  # Determine a machine-readable reason alongside the human-readable
  # actual_sv token. Kept in sync so the summary JSON always carries
  # both a value and an explanation, even when jq fails outright.
  local actual_sv="<unknown>" reason="ok"
  if [ ! -e "$target" ]; then
    actual_sv="<missing-file>"; reason="missing-file"
  elif [ ! -s "$target" ]; then
    actual_sv="<empty-file>";   reason="empty-file"
  elif ! command -v jq >/dev/null 2>&1; then
    actual_sv="<unknown>";      reason="jq-missing"
  else
    local jq_out jq_rc
    jq_out="$(jq -r '(.schema_version // "<missing>") | tostring' -- "$target" 2>/dev/null)"; jq_rc=$?
    if [ "$jq_rc" -ne 0 ]; then
      actual_sv="<unreadable>"; reason="jq-parse-failed"
    else
      actual_sv="$jq_out"
      if [ "$actual_sv" = "<missing>" ]; then reason="schema_version-missing"; fi
    fi
  fi

  local status sub=0
  if out_txt="$(bash "$script" "$target" 2>&1)"; then
    echo "$out_txt" >> "$errfile"
    status="OK"
  else
    sub=$?
    rc=$sub
    status="FAIL"
    echo "$out_txt" >> "$errfile"
    local excerpt
    excerpt="$(printf '%s\n' "$out_txt" \
      | awk 'NF' \
      | awk 'BEGIN{ORS=""} {gsub(/%/,"%25"); gsub(/\r/,""); gsub(/\n/,""); print (NR>1 ? "%0A" $0 : $0)}')"
    local expected_sv="${PI_CI_EXPECTED_SCHEMA_VERSION-1}"
    # If the schema checker failed but we couldn't attribute a specific
    # reason above (file exists, jq parsed), it's a schema mismatch.
    if [ "$reason" = "ok" ]; then reason="schema-drift"; fi
    echo "::error file=${target}::${label} schema check failed (exit=${sub}) — expected schema_version=${expected_sv}, actual=${actual_sv} — reason=${reason} — see ${errfile} — excerpt: ${excerpt}"
    echo "report-schema-errors: ${errfile}"
  fi
  echo "" >> "$errfile"

  labels+=("$label")
  paths+=("$target")
  actuals+=("$actual_sv")
  statuses+=("$status")
  exits+=("$sub")
  reasons+=("$reason")
}

run_check "extracted-tree.json"  "$here/pi-ci-manifest-schema-check.sh"          "$mf"
run_check "preflight-status.json" "$here/pi-ci-preflight-status-schema-check.sh" "$pf"

echo "report-schema-errors: $errfile"

# Emit machine-readable summary. Consumed by CI parsers and follow-up
# tooling — keep schema stable ("pi-ci/report-schema-validation-summary/v1").
# Per-file `reason` values: "ok" | "missing-file" | "empty-file" |
# "jq-missing" | "jq-parse-failed" | "schema_version-missing" |
# "schema-drift". The top-level `terminated_by` captures timeouts
# (SIGTERM/INT/HUP) written by the trap handler.
{
  printf '{"schema":"pi-ci/report-schema-validation-summary/v1"'
  printf ',"expected_schema_version":"%s"' "$EXPECTED_SV"
  printf ',"out_dir":"%s"' "$out"
  printf ',"terminated_by":null'
  printf ',"files":['
  for i in "${!labels[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '{"label":"%s","path":"%s","expected_schema_version":"%s","actual_schema_version":"%s","status":"%s","exit":%s,"reason":"%s"}' \
      "${labels[$i]}" "${paths[$i]}" "$EXPECTED_SV" "${actuals[$i]}" "${statuses[$i]}" "${exits[$i]}" "${reasons[$i]}"
  done
  printf ']'
  printf ',"exit":%s' "$rc"
  printf '}\n'
} > "$summary"
echo "report-schema-validation-summary: $summary"

echo "── schema-validate exit codes ──"
echo "  0 = all schemas OK"
echo "  2 = tooling missing (jq) OR bad PI_CI_EXPECTED_SCHEMA_VERSION OR missing/empty JSON input"
echo "  5 = schema violation (includes schema_version mismatch)"
echo "  note: content_hash mismatch is reported by the zip-verify target with exit=3, not by this script"
echo "  exit-code-final: ${rc}"

if [ "$rc" -ne 0 ]; then
  echo "report schema check FAILED — details in $errfile" >&2
  cat "$errfile" >&2 || true
fi
finalized=1
exit "$rc"
