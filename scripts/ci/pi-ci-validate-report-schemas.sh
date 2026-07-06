#!/usr/bin/env bash
# Run schema checks for BOTH extracted-tree.json and preflight-status.json
# in one shot. Used by CI + local Makefile so E2E / repro fails fast on
# report format drift. On failure, writes captured jq/schema error output
# to <out-dir>/report-schema-errors.txt (dedicated artifact upload path)
# and emits a GitHub Actions ::error annotation pointing at the bad file.
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

# Validate configurable expected schema_version. Non-integer or empty
# values fail fast with a clear error — CI + local users get a real
# signal instead of every check silently reporting "expected=<garbage>".
EXPECTED_SV="${PI_CI_EXPECTED_SCHEMA_VERSION:-1}"
if ! printf '%s' "$EXPECTED_SV" | grep -Eq '^[0-9]+$'; then
  echo "ERROR: PI_CI_EXPECTED_SCHEMA_VERSION must be a non-empty integer (got: '${EXPECTED_SV}')" >&2
  exit 2
fi
export PI_CI_EXPECTED_SCHEMA_VERSION="$EXPECTED_SV"

mkdir -p "$out" 2>/dev/null || true
: > "$errfile"

# Always print the configured expected schema_version FIRST so it lands
# at the top of report-schema-validation-log.txt (CI tees stdout into
# it), even when jq/schema parsing fails or the process is killed.
echo "pi-ci-validate-report-schemas: expected schema_version=${EXPECTED_SV}"
echo "pi-ci-validate-report-schemas: out-dir=${out}"

rc=0
run_check() {
  local label="$1" script="$2" target="$3"
  echo "── $label ($target) ──" >> "$errfile"
  if out_txt="$(bash "$script" "$target" 2>&1)"; then
    echo "$out_txt" >> "$errfile"
  else
    local sub=$?
    rc=$sub
    echo "$out_txt" >> "$errfile"
    # Full jq/schema excerpt (all non-empty lines, %0A-escaped for
    # GitHub Actions single-line annotations). Always emits a pointer
    # to the full log so triagers can open the uploaded artifact.
    local excerpt
    excerpt="$(printf '%s\n' "$out_txt" \
      | awk 'NF' \
      | awk 'BEGIN{ORS=""} {gsub(/%/,"%25"); gsub(/\r/,""); gsub(/\n/,""); print (NR>1 ? "%0A" $0 : $0)}')"
    # Extract expected/actual schema_version so the annotation shows
    # the version drift inline. Expected is configurable via
    # PI_CI_EXPECTED_SCHEMA_VERSION (default "1") and shared with the
    # per-file schema checkers.
    local expected_sv="${PI_CI_EXPECTED_SCHEMA_VERSION:-1}"
    local actual_sv="<unknown>"
    if command -v jq >/dev/null 2>&1 && [ -s "$target" ]; then
      actual_sv="$(jq -r '(.schema_version // "<missing>") | tostring' -- "$target" 2>/dev/null || echo "<unreadable>")"
    fi
    echo "::error file=${target}::${label} schema check failed (exit=${sub}) — expected schema_version=${expected_sv}, actual=${actual_sv} — see ${errfile} — excerpt: ${excerpt}"
    echo "report-schema-errors: ${errfile}"
  fi
  echo "" >> "$errfile"
}

run_check "extracted-tree.json"  "$here/pi-ci-manifest-schema-check.sh"          "$mf"
run_check "preflight-status.json" "$here/pi-ci-preflight-status-schema-check.sh" "$pf"

echo "report-schema-errors: $errfile"

if [ "$rc" -ne 0 ]; then
  echo "report schema check FAILED — details in $errfile" >&2
  cat "$errfile" >&2 || true
fi
exit "$rc"
