#!/usr/bin/env bash
# Post-deploy response-policy contract for the canonical public origin.
set -euo pipefail

URL="${1:-${SMOKE_BASE_URL:-https://note.syrin.online/}}"
echo "verify-frame-ancestors: probing canonical origin"

headers=$(curl -sSIL --max-time 15 "$URL")
csp=$(printf '%s\n' "$headers" \
  | awk 'BEGIN{IGNORECASE=1} /^content-security-policy:/ {sub(/^[^:]*:[[:space:]]*/,""); print; exit}')
permissions=$(printf '%s\n' "$headers" \
  | awk 'BEGIN{IGNORECASE=1} /^permissions-policy:/ {sub(/^[^:]*:[[:space:]]*/,""); print; exit}')
x_frame_options=$(printf '%s\n' "$headers" \
  | awk 'BEGIN{IGNORECASE=1} /^x-frame-options:/ {sub(/^[^:]*:[[:space:]]*/,""); print; exit}')

if [[ -z "$csp" ]]; then
  echo "verify-frame-ancestors: FAIL - no Content-Security-Policy header" >&2
  exit 1
fi

required_csp_tokens=(
  "default-src 'self'"
  "base-uri 'none'"
  "object-src 'none'"
  "form-action 'self'"
  "frame-ancestors 'self' chrome-extension://*"
  "script-src 'self' https://challenges.cloudflare.com"
  "connect-src 'self' https://onfzjmfjldsbthchssfr.supabase.co"
  "worker-src 'self' blob:"
  "upgrade-insecure-requests"
)

for token in "${required_csp_tokens[@]}"; do
  if [[ "$csp" != *"$token"* ]]; then
    echo "verify-frame-ancestors: FAIL - CSP missing required directive" >&2
    exit 1
  fi
done

if [[ -z "$permissions" ]]; then
  echo "verify-frame-ancestors: FAIL - no permissions-policy header" >&2
  exit 1
fi

for token in "camera=()" "geolocation=()" "microphone=()" "payment=()"; do
  if [[ "$permissions" != *"$token"* ]]; then
    echo "verify-frame-ancestors: FAIL - Permissions-Policy is incomplete" >&2
    exit 1
  fi
done

if [[ -n "$x_frame_options" ]]; then
  echo "verify-frame-ancestors: FAIL - X-Frame-Options conflicts with the embed contract" >&2
  exit 1
fi

echo "verify-frame-ancestors: OK"
