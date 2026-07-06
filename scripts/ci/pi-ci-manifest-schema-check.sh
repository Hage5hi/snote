#!/usr/bin/env bash
# Schema/format check for an extracted-tree.json manifest produced by
# scripts/ci/pi-ci-extracted-tree-manifest.sh. Used by E2E tests and CI
# to confirm structure (not just file existence).
#
# Required top-level keys and types (schema v1):
#   schema        string, must equal "pi-ci/extracted-tree/v1"
#   generated_at  string (ISO-8601-ish, non-empty)
#   root          string, non-empty
#   walk_ok       boolean
#   content_hash  string, non-empty, "<algo>:<hex-or-token>"
#   entries       array of { path:string, size:number }
#
# Usage:
#   scripts/ci/pi-ci-manifest-schema-check.sh <manifest.json>
# Exits: 0 ok, 2 tooling/missing file, 5 schema violation.
set -u
set -o pipefail

f="${1:?usage: $0 <extracted-tree.json>}"
command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
[ -s "$f" ] || { echo "ERROR: manifest not present or empty: $f" >&2; exit 2; }

# Configurable expected schema_version. Defaults to "1"; override with
# PI_CI_EXPECTED_SCHEMA_VERSION when validating a bumped format.
EXPECTED_SV="${PI_CI_EXPECTED_SCHEMA_VERSION:-1}"

problems="$(EXPECTED_SV="$EXPECTED_SV" jq -r --arg expected "$EXPECTED_SV" '
  . as $m |
  [
    (if ($m.schema // "") != "pi-ci/extracted-tree/v1" then "  - schema: expected \"pi-ci/extracted-tree/v1\", got \($m.schema|tostring)" else empty end),
    (if (($m.schema_version // "") | tostring) != $expected then "  - schema_version: expected \"\($expected)\", got \($m.schema_version|tostring)" else empty end),
    (if (($m.generated_at // "") | type) != "string" or (($m.generated_at // "") | length) == 0 then "  - generated_at: missing/empty string" else empty end),
    (if (($m.root // "") | type) != "string" or (($m.root // "") | length) == 0 then "  - root: missing/empty string" else empty end),
    (if ($m | has("walk_ok") | not) or (($m.walk_ok | type) != "boolean") then "  - walk_ok: missing or not boolean" else empty end),
    (if (($m.content_hash // "") | type) != "string" or (($m.content_hash // "") | test("^[A-Za-z0-9_-]+:.+$") | not) then "  - content_hash: missing or not \"<algo>:<value>\"" else empty end),
    (if ($m.entries | type) != "array" then "  - entries: not an array"
     else ([$m.entries[] | select((.path|type)!="string" or (.size|type)!="number")] | length) as $bad
          | if $bad>0 then "  - entries: \($bad) row(s) missing string path / number size" else empty end
     end)
  ] | .[]' -- "$f" 2>/dev/null)"

if [ -n "$problems" ]; then
  echo "ERROR: extracted-tree manifest failed schema check (path=$f):" >&2
  echo "$problems" >&2
  exit 5
fi
echo "OK: $f matches pi-ci/extracted-tree/v1"
