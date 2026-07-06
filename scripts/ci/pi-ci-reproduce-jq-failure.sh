#!/usr/bin/env bash
# Print — or override — the exact jq_cmdline, jq_timeout_secs, jq_bin,
# input dump paths, and expected/actual schema_version recorded in a
# report-schema-validation-summary.json, so a developer can rerun a
# jq-parse-failed / jq-timeout / schema-drift case locally.
#
# Usage:
#   scripts/ci/pi-ci-reproduce-jq-failure.sh <summary.json> [flags]
#
# Flags (all optional — override values from the summary):
#   --jq-timeout-secs <N>     Override PI_CI_JQ_TIMEOUT_SECS for the rerun.
#   --input <path>            Rerun only for this input path (repeatable).
#   --label <label>           Rerun only for this per-file label (repeatable).
#   --expected <value>        Override PI_CI_EXPECTED_SCHEMA_VERSION.
#   --actual <value>          Print an explicit expected-vs-actual line
#                             (does not affect the rerun command).
#   --run                     Actually execute the rerun command instead of
#                             just printing it.
#   -h | --help               Show this help.
#
# Exit 0 on success. Exit 2 on bad args or missing summary.
set -euo pipefail

usage() { sed -n '2,20p' "$0"; }

summary=""
override_timeout=""
override_expected=""
override_actual=""
filter_inputs=()
filter_labels=()
do_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --jq-timeout-secs) override_timeout="${2:?}"; shift 2 ;;
    --input)           filter_inputs+=("${2:?}"); shift 2 ;;
    --label)           filter_labels+=("${2:?}"); shift 2 ;;
    --expected)        override_expected="${2:?}"; shift 2 ;;
    --actual)          override_actual="${2:?}"; shift 2 ;;
    --run)             do_run=1; shift ;;
    --) shift; break ;;
    -*) echo "ERROR: unknown flag: $1" >&2; usage; exit 2 ;;
    *)  [ -z "$summary" ] && summary="$1" || { echo "ERROR: unexpected positional: $1" >&2; exit 2; }
        shift ;;
  esac
done

[ -n "$summary" ] || { echo "ERROR: missing <summary.json>" >&2; usage; exit 2; }
[ -s "$summary" ] || { echo "ERROR: summary not found or empty: $summary" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required" >&2; exit 2; }

# Header
echo "── pi-ci jq failure reproduction ──"
echo "summary:          $summary"
jq -r '
  "expected_schema_version=\(.expected_schema_version)",
  "out_dir=               \(.out_dir)",
  "pi_ci_jq_bin=          \(.pi_ci_jq_bin)",
  "jq_bin=                \(.jq_bin)",
  "jq_version=            \(.jq_version)",
  "jq_cmdline=            \(.jq_cmdline)",
  "jq_timeout_secs=       \(.jq_timeout_secs)"
' "$summary"
[ -n "$override_expected" ] && echo "override: PI_CI_EXPECTED_SCHEMA_VERSION=${override_expected}"
[ -n "$override_timeout" ]  && echo "override: PI_CI_JQ_TIMEOUT_SECS=${override_timeout}"
[ -n "$override_actual" ]   && echo "override: (informational) actual_schema_version=${override_actual}"

# Build jq filter for row selection
sel='(.reason == "jq-parse-failed" or .reason == "jq-timeout" or .reason == "schema-drift" or (.reason | startswith("schema_version-")))'
if [ ${#filter_inputs[@]} -gt 0 ]; then
  paths_json="$(printf '%s\n' "${filter_inputs[@]}" | jq -R . | jq -s .)"
  sel="$sel and (.path as \$p | ${paths_json} | index(\$p))"
fi
if [ ${#filter_labels[@]} -gt 0 ]; then
  labels_json="$(printf '%s\n' "${filter_labels[@]}" | jq -R . | jq -s .)"
  sel="$sel and (.label as \$l | ${labels_json} | index(\$l))"
fi

expected_env="${override_expected:-$(jq -r '.expected_schema_version' "$summary")}"
timeout_env="${override_timeout:-$(jq -r '.jq_timeout_secs' "$summary")}"
jq_bin_val="$(jq -r '.pi_ci_jq_bin // .jq_bin // "jq"' "$summary")"

echo
echo "── matching per-file entries ──"
while IFS=$'\t' read -r label reason path stderr_path expected actual excerpt; do
  out_dir="$(dirname "$path")"
  repro="PI_CI_EXPECTED_SCHEMA_VERSION=${expected_env}"
  [ -n "$timeout_env" ] && [ "$timeout_env" != "null" ] && repro+=" PI_CI_JQ_TIMEOUT_SECS=${timeout_env}"
  [ -n "$jq_bin_val" ]  && [ "$jq_bin_val"  != "null" ] && repro+=" PI_CI_JQ_BIN=${jq_bin_val}"
  repro+=" scripts/ci/pi-ci-validate-report-schemas.sh \"${out_dir}\""

  echo "label=          ${label}"
  echo "reason=         ${reason}"
  echo "input_path=     ${path}"
  echo "stderr_path=    ${stderr_path}"
  echo "expected=       ${expected}"
  echo "actual=         ${actual}"
  echo "excerpt=        ${excerpt}"
  echo "repro:          ${repro}"
  if [ "$do_run" = 1 ]; then
    echo "── running rerun ──"
    bash -c "$repro" || echo "(rerun exited non-zero — expected for a failing case)"
  fi
  echo "----"
done < <(jq -r --argjson sel_true true '
  .files[]
  | select('"$sel"')
  | [ .label, .reason, .path, (.jq_stderr_path // "<none>"),
      .expected_schema_version, .actual_schema_version,
      (.jq_stderr_excerpt // "<none>") ]
  | @tsv
' "$summary")
