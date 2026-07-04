#!/usr/bin/env bash
# Reproduce the install-prompt focus-trap failure locally with headed
# Chromium and stream focus/activeElement debug output to stdout.
#
# Prereqs (one-time):
#   bunx playwright install chromium
#
# Usage:
#   ./scripts/debug-install-prompt-focus.sh                       # shift-tab spec
#   ./scripts/debug-install-prompt-focus.sh e2e/<other>.spec.ts   # any install-prompt spec
#
# Env knobs:
#   PWDEBUG=1     -> open Playwright Inspector, step through frames
#   SLOWMO=250    -> slow each action by N ms so you can watch focus move
set -euo pipefail

SPEC="${1:-e2e/install-prompt-shift-tab-after-backdrop.spec.ts}"
SLOWMO="${SLOWMO:-150}"

echo "▶ Running: $SPEC (headed, slowMo=${SLOWMO}ms)"
echo "▶ Debug JSON attachments will land under test-results/**/focus-trap-escape-*.json"
echo

# --headed + --project=chromium + list reporter shows step-by-step,
# and DEBUG=pw:api dumps every Playwright API call including focus moves.
DEBUG="${DEBUG:-pw:api}" \
PWTEST_SLOW_MO="$SLOWMO" \
bunx playwright test "$SPEC" \
  --project=chromium \
  --headed \
  --reporter=list \
  --workers=1 \
  "${@:2}"

STATUS=$?

echo
echo "▶ Focus-trap escape artifacts:"
find test-results -name 'focus-trap-escape-*.json' -print -exec sh -c 'echo "---"; cat "$1"; echo' _ {} \; || true

exit "$STATUS"
