#!/usr/bin/env bash
set -euo pipefail

if ! bunx playwright install --with-deps chromium; then
  fallback="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}"
  if [ -z "$fallback" ]; then
    for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
      if command -v "$candidate" >/dev/null 2>&1; then
        fallback="$(command -v "$candidate")"
        break
      fi
    done
  fi
  if [ -z "$fallback" ] || [ ! -x "$fallback" ]; then
    echo "No Playwright Chromium binary and no executable system Chromium fallback." >&2
    exit 1
  fi
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$fallback"
fi

exec bunx playwright "$@"