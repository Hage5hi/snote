#!/usr/bin/env bash
# Reproduce install-prompt focus-trap failures locally with headed
# Chromium/Firefox/WebKit and stream focus/activeElement debug output.
#
# Prereqs (one-time):
#   bunx playwright install chromium firefox webkit
#
# Usage:
#   ./scripts/debug-install-prompt-focus.sh [--spec PATH] [--browser NAME] [--retry N] [--slowmo MS] [-- <extra pw args>]
#
# Flags:
#   -s, --spec PATH       Spec file (default: e2e/install-prompt-shift-tab-after-backdrop.spec.ts)
#   -b, --browser NAME    chromium | firefox | webkit    (default: chromium)
#   -r, --retry N         Playwright retries for THIS run (default: 0). Set >0 to
#                         emit -retry1/-retry2 output dirs matching CI structure.
#   -m, --slowmo MS       Slow every PW action by N ms   (default: 150)
#   -h, --help            Show this help.
#
# Env knobs:
#   PWDEBUG=1     Open Playwright Inspector (overrides --slowmo).
#
# Examples:
#   ./scripts/debug-install-prompt-focus.sh -b firefox -r 2
#   ./scripts/debug-install-prompt-focus.sh --spec e2e/install-prompt-esc-focus-release.spec.ts
set -euo pipefail

SPEC="e2e/install-prompt-shift-tab-after-backdrop.spec.ts"
BROWSER="chromium"
RETRY="0"
SLOWMO="${SLOWMO:-150}"
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    -s|--spec)    SPEC="$2"; shift 2 ;;
    -b|--browser) BROWSER="$2"; shift 2 ;;
    -r|--retry)   RETRY="$2"; shift 2 ;;
    -m|--slowmo)  SLOWMO="$2"; shift 2 ;;
    -h|--help)    sed -n '2,26p' "$0"; exit 0 ;;
    --)           shift; EXTRA=("$@"); break ;;
    *)            echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

case "$BROWSER" in chromium|firefox|webkit) ;; *)
  echo "Invalid --browser '$BROWSER' (chromium|firefox|webkit)" >&2; exit 2 ;;
esac

echo "▶ spec=$SPEC  browser=$BROWSER  retries=$RETRY  slowMo=${SLOWMO}ms"
echo "▶ Focus-trap JSON will land under test-results/**/focus-trap-escape-*.json"
echo

DEBUG="${DEBUG:-pw:api}" \
PWTEST_SLOW_MO="$SLOWMO" \
bunx playwright test "$SPEC" \
  --project="$BROWSER" \
  --headed \
  --retries="$RETRY" \
  --reporter=list \
  --workers=1 \
  "${EXTRA[@]}"

STATUS=$?

echo
echo "▶ Focus-trap escape artifacts (browser=$BROWSER):"
find test-results -type f -name 'focus-trap-escape-*.json' -print \
  -exec sh -c 'echo "--- $1"; cat "$1"; echo' _ {} \; || true

exit "$STATUS"
