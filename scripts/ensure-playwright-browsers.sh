#!/usr/bin/env bash
# Ensure Playwright Chromium is installed, with a system-browser fallback for
# restricted sandboxes where Playwright's managed download is unavailable.
set -euo pipefail

if bunx playwright install --with-deps chromium; then
  exit 0
fi

echo "▶ Playwright Chromium install failed. Looking for system Chromium fallback..." >&2
for candidate in "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" chromium chromium-browser google-chrome google-chrome-stable; do
  [ -n "$candidate" ] || continue
  if command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ]; then
    resolved="$(command -v "$candidate" 2>/dev/null || printf '%s' "$candidate")"
    echo "▶ Using system Chromium fallback: $resolved" >&2
    exit 0
  fi
done

echo "✖ No Playwright-managed Chromium and no system Chromium fallback found." >&2
exit 1
