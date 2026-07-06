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
diffs=()
jq_stderr_excerpts=()
jq_stderr_paths=()

rc=0
# jq binary + optional timeout override. `PI_CI_JQ_BIN` lets tests
# substitute a fake jq (e.g. one that exits 124 to simulate timeout).
# `PI_CI_JQ_TIMEOUT_SECS`, when set and `timeout(1)` is available,
# wraps every jq invocation so a hung jq is caught + reported as
# reason="jq-timeout" instead of hanging the whole CI step.
JQ_BIN="${PI_CI_JQ_BIN:-jq}"
JQ_WRAP=""
if [ -n "${PI_CI_JQ_TIMEOUT_SECS:-}" ] && command -v timeout >/dev/null 2>&1; then
  JQ_WRAP="timeout ${PI_CI_JQ_TIMEOUT_SECS} "
fi
JQ_SCHEMA_VERSION_FILTER='if has("schema_version") then (.schema_version | tostring) else "<missing>" end'
# jq diagnostics — echoed into report-schema-validation-log.txt AND
# embedded in the summary JSON so triagers can reproduce jq-timeout
# or jq-parse-failed runs without guessing which jq was used or
# whether a timeout(1) wrapper was applied.
JQ_VERSION="$("$JQ_BIN" --version 2>/dev/null || echo '<unavailable>')"
JQ_CMDLINE="${JQ_WRAP}${JQ_BIN} -r '${JQ_SCHEMA_VERSION_FILTER}' -- <file>"
echo "pi-ci-validate-report-schemas: PI_CI_JQ_BIN=${PI_CI_JQ_BIN:-<unset>}"
echo "pi-ci-validate-report-schemas: jq_bin=${JQ_BIN}"
echo "pi-ci-validate-report-schemas: jq_version=${JQ_VERSION}"
echo "pi-ci-validate-report-schemas: jq_cmdline=${JQ_CMDLINE}"
echo "pi-ci-validate-report-schemas: jq_timeout_secs=${PI_CI_JQ_TIMEOUT_SECS:-<unset>}"

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\r'/}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

stderr_excerpt() {
  local file="$1"
  [ -s "$file" ] || return 0
  awk 'NF {print; seen++; if (seen >= 3) exit}' "$file" | tr '\n' ' ' | cut -c 1-500
}

schema_probe_exit_for_reason() {
  case "$1" in
    jq-missing|jq-parse-failed|jq-timeout|missing-file|empty-file) echo 2 ;;
    schema_version-missing|schema_version-empty|schema_version-malformed|schema-drift) echo 5 ;;
    *) echo 5 ;;
  esac
}

run_check() {
  local label="$1" script="$2" target="$3"
  echo "── $label ($target) ──" >> "$errfile"

  # Determine a machine-readable reason alongside the human-readable
  # actual_sv token. Kept in sync so the summary JSON always carries
  # both a value and an explanation, even when jq fails outright.
  local actual_sv="<unknown>" reason="ok" diff_json="null" jq_stderr_file="" jq_excerpt=""
  if [ ! -e "$target" ]; then
    actual_sv="<missing-file>"; reason="missing-file"
  elif [ ! -s "$target" ]; then
    actual_sv="<empty-file>";   reason="empty-file"
  elif ! command -v "$JQ_BIN" >/dev/null 2>&1; then
    actual_sv="<unknown>";      reason="jq-missing"
  else
    local jq_out jq_rc slug
    slug="$(printf '%s' "$label" | sed 's/[^A-Za-z0-9]/-/g')"
    jq_stderr_file="$out/report-schema-jq-${slug}.stderr.txt"
    jq_out="$(${JQ_WRAP}"$JQ_BIN" -r "$JQ_SCHEMA_VERSION_FILTER" -- "$target" 2>"$jq_stderr_file")"; jq_rc=$?
    if [ "$jq_rc" -eq 124 ]; then
      actual_sv="<timeout>"; reason="jq-timeout"
      jq_excerpt="$(stderr_excerpt "$jq_stderr_file")"
      [ -z "$jq_excerpt" ] && jq_excerpt="jq timed out after ${PI_CI_JQ_TIMEOUT_SECS:-<unset>}s (exit 124)"
    elif [ "$jq_rc" -ne 0 ]; then
      actual_sv="<unreadable>"; reason="jq-parse-failed"
      jq_excerpt="$(stderr_excerpt "$jq_stderr_file")"

    else
      actual_sv="$jq_out"
      if [ "$actual_sv" = "<missing>" ]; then
        reason="schema_version-missing"
      elif [ "$actual_sv" = "" ]; then
        reason="schema_version-empty"
      elif ! printf '%s' "$actual_sv" | grep -Eq '^[0-9]+$'; then
        # Present but non-numeric — e.g. "v2", "1.0", "abc". Keep the
        # exact received value in actual_sv so triagers see the drift.
        reason="schema_version-malformed"
      fi
    fi
  fi

  local status sub=0 out_txt=""
  if out_txt="$(bash "$script" "$target" 2>&1)"; then
    echo "$out_txt" >> "$errfile"
    status="OK"
  else
    sub=$?
    rc=$sub
    status="FAIL"
    echo "$out_txt" >> "$errfile"
  fi

  if [ "$status" = "OK" ] && [ "$reason" != "ok" ]; then
    sub="$(schema_probe_exit_for_reason "$reason")"
    rc=$sub
    status="FAIL"
    out_txt="ERROR: ${label} schema_version probe failed before schema check (path=${target}, reason=${reason}, actual=${actual_sv})"
    echo "$out_txt" >> "$errfile"
  fi

  if [ "$status" = "FAIL" ]; then
    local excerpt
    excerpt="$(printf '%s\n' "$out_txt" \
      | awk 'NF' \
      | awk 'BEGIN{ORS=""} {gsub(/%/,"%25"); gsub(/\r/,""); gsub(/\n/,""); print (NR>1 ? "%0A" $0 : $0)}')"
    local expected_sv="${PI_CI_EXPECTED_SCHEMA_VERSION-1}"
    # If the schema checker failed but we couldn't attribute a specific
    # reason above (file exists, jq parsed as valid integer), it's a
    # schema mismatch.
    if [ "$reason" = "ok" ]; then reason="schema-drift"; fi
    # Diff context for drift-family reasons — surfaces expected vs
    # actual field values inline so triagers don't need the JSON.
    case "$reason" in
      schema-drift|schema_version-malformed|schema_version-missing|schema_version-empty)
        diff_json="{\"schema_version\":{\"expected\":\"$(json_escape "$expected_sv")\",\"actual\":\"$(json_escape "$actual_sv")\"}}"
        echo "── ${label} drift diff ──"
        echo "  schema_version: expected=${expected_sv}  actual=${actual_sv}"
        ;;
    esac
    if { [ "$reason" = "jq-parse-failed" ] || [ "$reason" = "jq-timeout" ]; } && [ -n "$jq_excerpt" ]; then
      echo "── ${label} jq stderr excerpt ──"
      echo "  ${jq_excerpt}"
      echo "  jq_stderr_path=${jq_stderr_file}"
      echo "jq stderr excerpt: ${jq_excerpt} (path=${jq_stderr_file})" >> "$errfile"
    fi
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
  diffs+=("$diff_json")
  jq_stderr_excerpts+=("$jq_excerpt")
  jq_stderr_paths+=("$jq_stderr_file")
}

run_check "extracted-tree.json"  "$here/pi-ci-manifest-schema-check.sh"          "$mf"
run_check "preflight-status.json" "$here/pi-ci-preflight-status-schema-check.sh" "$pf"

echo "report-schema-errors: $errfile"

# Emit machine-readable summary. Consumed by CI parsers and follow-up
# tooling — keep schema stable ("pi-ci/report-schema-validation-summary/v1").
# Per-file `reason` values: "ok" | "missing-file" | "empty-file" |
# "jq-missing" | "jq-parse-failed" | "jq-timeout" |
# "schema_version-missing" | "schema_version-empty" |
# "schema_version-malformed" | "schema-drift". The top-level `terminated_by` captures timeouts
# (SIGTERM/INT/HUP) written by the trap handler.
{
  printf '{"schema":"pi-ci/report-schema-validation-summary/v1"'
  printf ',"expected_schema_version":"%s"' "$EXPECTED_SV"
  printf ',"out_dir":"%s"' "$out"
  printf ',"terminated_by":null'
  printf ',"files":['
  for i in "${!labels[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '{"label":"%s","path":"%s","expected_schema_version":"%s","actual_schema_version":"%s","status":"%s","exit":%s,"reason":"%s","diff":%s' \
      "$(json_escape "${labels[$i]}")" "$(json_escape "${paths[$i]}")" "$(json_escape "$EXPECTED_SV")" "$(json_escape "${actuals[$i]}")" "$(json_escape "${statuses[$i]}")" "${exits[$i]}" "$(json_escape "${reasons[$i]}")" "${diffs[$i]}"
    if [ -n "${jq_stderr_excerpts[$i]}" ]; then
      printf ',"jq_stderr_excerpt":"%s","jq_stderr_path":"%s"' \
        "$(json_escape "${jq_stderr_excerpts[$i]}")" "$(json_escape "${jq_stderr_paths[$i]}")"
    else
      printf ',"jq_stderr_excerpt":null,"jq_stderr_path":null'
    fi
    printf '}'
  done
  printf ']'
  printf ',"pi_ci_jq_bin":"%s"' "$(json_escape "${PI_CI_JQ_BIN:-}")"
  printf ',"jq_bin":"%s"' "$(json_escape "$JQ_BIN")"
  printf ',"jq_version":"%s"' "$(json_escape "$JQ_VERSION")"
  printf ',"jq_cmdline":"%s"' "$(json_escape "$JQ_CMDLINE")"
  printf ',"jq_timeout_secs":"%s"' "$(json_escape "${PI_CI_JQ_TIMEOUT_SECS:-}")"
  printf ',"exit":%s' "$rc"
  printf '}\n'
} > "$summary"
echo "report-schema-validation-summary: $summary"

# Human-readable reasons recap — mirrors summary.json files[].reason so
# developers spot parse/timeout/missing causes without opening the JSON.
echo "── per-file reasons ──"
for i in "${!labels[@]}"; do
  printf "  %-24s status=%-4s reason=%-24s actual=%s\n" \
    "${labels[$i]}" "${statuses[$i]}" "${reasons[$i]}" "${actuals[$i]}"
done

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
