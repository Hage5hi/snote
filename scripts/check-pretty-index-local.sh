#!/usr/bin/env bash
# One-command local/CI pre-push check: run the generator self-check and
# the strict validator against a pretty-index.json to catch schema drift.
#
# Usage:
#   scripts/check-pretty-index-local.sh [--report <path>] [path/to/pretty-index.json]
#
# Defaults to ./pretty-index.json when no positional argument is given.
# When --report <path> is provided, the validator's machine-readable
# --report JSON is written to <path> (created even on success so CI can
# always upload it as an artifact).
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

REPORT=""
INDEX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --report)
      shift
      if [ $# -eq 0 ]; then
        echo "check-pretty-index-local: --report requires a path" >&2
        exit 2
      fi
      REPORT="$1"; shift ;;
    --report=*)
      REPORT="${1#--report=}"; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    --*)
      echo "check-pretty-index-local: unknown flag: $1" >&2; exit 2 ;;
    *)
      if [ -n "$INDEX" ]; then
        echo "check-pretty-index-local: unexpected extra argument: $1" >&2
        exit 2
      fi
      INDEX="$1"; shift ;;
  esac
done
INDEX="${INDEX:-pretty-index.json}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$INDEX" ]; then
  echo "check-pretty-index-local: file not found: $INDEX" >&2
  exit 4
fi

echo "==> [1/2] generator self-check (schema_version drift)"
python3 "$HERE/check-pretty-index-schema-version.py" "$INDEX"

echo "==> [2/2] validator (--require-version 1${REPORT:+ --report -> $REPORT})"
if [ -n "$REPORT" ]; then
  mkdir -p -- "$(dirname -- "$REPORT")"
  python3 "$HERE/validate-pretty-index.py" --require-version 1 --report "$INDEX" > "$REPORT"
else
  python3 "$HERE/validate-pretty-index.py" --require-version 1 --report "$INDEX" >/dev/null
fi

echo "OK: $INDEX passes both self-check and strict validation."
