#!/usr/bin/env bash
# One-command local pre-push check: run the generator self-check and the
# strict validator against a pretty-index.json to catch schema drift
# before pushing.
#
# Usage:
#   scripts/check-pretty-index-local.sh [path/to/pretty-index.json]
#
# Defaults to ./pretty-index.json when no argument is given.
#
# Exit codes:
#   0  both checks passed (generator emits current schema, file validates)
#   1  self-check failed (schema drift between generator and validator)
#   3  validator schema validation failed
#   4  file not found
#   *  any other non-zero from either script is surfaced verbatim
#
# See docs/schema-drift-diff-test-hooks.md for the full contract.
set -euo pipefail

INDEX="${1:-pretty-index.json}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$INDEX" ]; then
  echo "check-pretty-index-local: file not found: $INDEX" >&2
  exit 4
fi

echo "==> [1/2] generator self-check (schema_version drift)"
python3 "$HERE/check-pretty-index-schema-version.py" "$INDEX"

echo "==> [2/2] validator (--require-version 1, --report)"
python3 "$HERE/validate-pretty-index.py" --require-version 1 --report "$INDEX" >/dev/null

echo "OK: $INDEX passes both self-check and strict validation."
