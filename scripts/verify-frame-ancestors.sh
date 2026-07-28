#!/usr/bin/env bash
# Post-deploy response-policy contract for the canonical public origin.
set -euo pipefail

URL="${1:-${SMOKE_BASE_URL:-https://note.syrin.online/}}"
echo "verify-frame-ancestors: probing canonical origin"

headers=$(curl -sSI --max-time 15 --max-redirs 0 "$URL")
final_status=$(printf '%s\n' "$headers" \
  | awk '/^HTTP\// {status=$2} END {print status}')
if [[ ! "$final_status" =~ ^2[0-9][0-9]$ ]]; then
  echo "verify-frame-ancestors: FAIL - expected canonical 2xx response" >&2
  exit 1
fi

final_headers=$(printf '%s\n' "$headers" \
  | awk '/^HTTP\// {block=""; seen=1; next} {if (seen) block=block $0 ORS} END {printf "%s", block}')
csp=$(printf '%s\n' "$final_headers" \
  | awk 'BEGIN{IGNORECASE=1} /^content-security-policy:/ {sub(/^[^:]*:[[:space:]]*/,""); print; exit}')
permissions=$(printf '%s\n' "$final_headers" \
  | awk 'BEGIN{IGNORECASE=1} /^permissions-policy:/ {sub(/^[^:]*:[[:space:]]*/,""); print; exit}')
x_frame_options=$(printf '%s\n' "$final_headers" \
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
