#!/usr/bin/env bash
# Reproduce the wheel/trackpad CodeMirror E2E locally with the *exact*
# same viewport, device settings, warm-up deltas, and initialization the
# CI job uses — so failures reproduce byte-for-byte.
#
# The viewport, deviceScaleFactor, colorScheme, and reducedMotion values
# come from the spec's `test.use({...})` block; the warm-up wheel ticks
# and `scroll-behavior:auto` init-script are in the spec itself, so this
# script only pins the *runner* side (project, workers, retries, trace).
#
# Usage:
#   ./scripts/run-wheel-e2e.sh                  # headless, chromium, no retries
#   HEADED=1 ./scripts/run-wheel-e2e.sh         # open a real browser window
#   PLAYWRIGHT_PROJECT=firefox ./scripts/run-wheel-e2e.sh
#   RETRIES=2 ./scripts/run-wheel-e2e.sh        # match CI's retry count
set -euo pipefail

SPEC="e2e/note-wheel-trackpad-scroll.spec.ts"
PROJECT="${PLAYWRIGHT_PROJECT:-chromium}"
RETRIES="${RETRIES:-0}"
HEADED_FLAG=""
[ "${HEADED:-0}" = "1" ] && HEADED_FLAG="--headed"

echo "▶ wheel/trackpad E2E — project=$PROJECT retries=$RETRIES headed=${HEADED:-0}"
echo "  spec: $SPEC"
echo "  viewport 1280×900, dpr=1, reduced-motion=reduce, scroll-behavior=auto (see test.use + addInitScript)"

exec bunx playwright test \
  "$SPEC" \
  --project="$PROJECT" \
  --workers=1 \
  --retries="$RETRIES" \
  --trace=on \
  --reporter=list \
  $HEADED_FLAG \
  "$@"
