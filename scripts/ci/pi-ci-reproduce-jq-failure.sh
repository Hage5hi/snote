#!/usr/bin/env bash
# Print the exact jq_cmdline, jq_timeout_secs, jq_bin, and input dump paths
# recorded in a report-schema-validation-summary.json so a developer can
# rerun a jq-parse-failed / jq-timeout case locally.
#
# Usage:
#   scripts/ci/pi-ci-reproduce-jq-failure.sh <summary.json>
#
# Prints a copy-pasteable reproduction block for each per-file entry whose
# reason is jq-parse-failed or jq-timeout.
set -euo pipefail

summary="${1:?usage: $0 <report-schema-validation-summary.json>}"
[ -s "$summary" ] || { echo "ERROR: summary not found or empty: $summary" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required" >&2; exit 2; }

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

echo
echo "── failing per-file entries ──"
jq -r '
  .files[]
  | select(.reason == "jq-parse-failed" or .reason == "jq-timeout")
  | "label=      \(.label)\n" +
    "reason=     \(.reason)\n" +
    "input_path= \(.path)\n" +
    "stderr_path=\(.jq_stderr_path // "<none>")\n" +
    "excerpt=    \(.jq_stderr_excerpt // "<none>")\n" +
    "repro:      PI_CI_JQ_BIN=" + (env.PI_CI_JQ_BIN // "jq") +
      " PI_CI_JQ_TIMEOUT_SECS=" + (.jq_timeout_secs // "") +
      " scripts/ci/pi-ci-validate-report-schemas.sh \"$(dirname \"\(.path)\")\"\n" +
    "----"
' "$summary"
