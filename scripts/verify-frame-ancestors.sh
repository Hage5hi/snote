#!/usr/bin/env bash
# Post-deploy contract check: the app MUST send a
#   Content-Security-Policy: frame-ancestors 'self' chrome-extension://*
# header, otherwise the Chrome extension side panel can no longer embed
# the app (users see "Couldn't load Syrin Note"). Fails the workflow if
# the header is missing or does not include chrome-extension://*.
#
# Usage: scripts/verify-frame-ancestors.sh [url]
set -euo pipefail

URL="${1:-${SMOKE_BASE_URL:-https://note.syrin.online/}}"
echo "verify-frame-ancestors: probing $URL"

headers=$(curl -sSIL --max-time 15 "$URL")
csp=$(printf '%s\n' "$headers" \
  | awk 'BEGIN{IGNORECASE=1} /^content-security-policy:/ {sub(/^[^:]*:[[:space:]]*/,""); print; exit}')

if [[ -z "$csp" ]]; then
  echo "verify-frame-ancestors: FAIL — no Content-Security-Policy header on $URL" >&2
  printf '%s\n' "$headers" >&2
  exit 1
fi

if ! grep -qi "frame-ancestors" <<<"$csp"; then
  echo "verify-frame-ancestors: FAIL — CSP missing frame-ancestors directive" >&2
  echo "  CSP: $csp" >&2
  exit 1
fi

if ! grep -qi "chrome-extension://\*\|chrome-extension://" <<<"$csp"; then
  echo "verify-frame-ancestors: FAIL — frame-ancestors does not allow chrome-extension://*" >&2
  echo "  CSP: $csp" >&2
  exit 1
fi

echo "verify-frame-ancestors: OK — $csp"
