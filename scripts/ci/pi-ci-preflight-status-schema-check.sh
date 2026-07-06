#!/usr/bin/env bash
# Schema/format check for a preflight-status.json sidecar produced by
# scripts/ci/pi-ci-preflight-status-summary.sh. Complements
# pi-ci-manifest-schema-check.sh so CI + E2E fail fast on format drift.
#
# Required top-level keys (schema v1):
#   schema                    "pi-ci/preflight-status/v1"
#   scope                     non-empty string
#   validate_report           { status:string, path:string }
#   validate_schema_assertion { status:string, path:string }
#   content_hash              "<algo>:<value>"
#
# Usage: scripts/ci/pi-ci-preflight-status-schema-check.sh <preflight-status.json>
# Exits: 0 ok, 2 tooling/missing file, 5 schema violation.
set -u
set -o pipefail

f="${1:?usage: $0 <preflight-status.json>}"
command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
[ -s "$f" ] || { echo "ERROR: preflight-status.json not present or empty: $f" >&2; exit 2; }

EXPECTED_SV="${PI_CI_EXPECTED_SCHEMA_VERSION:-1}"

problems="$(jq -r --arg expected "$EXPECTED_SV" '
  . as $p |
  [
    (if ($p.schema // "") != "pi-ci/preflight-status/v1" then "  - schema: expected \"pi-ci/preflight-status/v1\", got \($p.schema|tostring)" else empty end),
    (if (($p.schema_version // "") | tostring) != $expected then "  - schema_version: expected \"\($expected)\", got \($p.schema_version|tostring)" else empty end),
    (if (($p.scope // "") | type) != "string" or (($p.scope // "") | length) == 0 then "  - scope: missing/empty string" else empty end),
    (if (($p.content_hash // "") | type) != "string" or (($p.content_hash // "") | test("^[A-Za-z0-9_-]+:.+$") | not) then "  - content_hash: missing or not \"<algo>:<value>\"" else empty end),
    (["validate_report","validate_schema_assertion"][] as $k
      | if ($p[$k] | type) != "object" then "  - \($k): not an object"
        elif (($p[$k].status // "") | type) != "string" or (($p[$k].status // "") | length) == 0 then "  - \($k).status: missing/empty string"
        elif (($p[$k].path   // "") | type) != "string" or (($p[$k].path   // "") | length) == 0 then "  - \($k).path: missing/empty string"
        else empty end)
  ] | .[]' -- "$f" 2>/dev/null)"

if [ -n "$problems" ]; then
  echo "ERROR: preflight-status.json failed schema check (path=$f):" >&2
  echo "$problems" >&2
  exit 5
fi
echo "OK: $f matches pi-ci/preflight-status/v1"
