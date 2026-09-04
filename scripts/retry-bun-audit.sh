#!/usr/bin/env bash
# Retry bun audit on transient registry/network errors only.
# Real high/critical findings still fail the job without extra attempts.
set -euo pipefail

MAX_ATTEMPTS=3
SLEEP_SECONDS=10
TRANSIENT_PATTERN='Timeout|ConnectionClosed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo|audit request failed|HTTP 5[0-9]{2}'
ADVISORY_PATTERN='GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}'

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  set +e
  bun audit --audit-level=high 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  set -e

  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    exit "$status"
  fi

  if grep -Eqi "$ADVISORY_PATTERN" "$log"; then
    exit "$status"
  fi

  if grep -Eqi "$TRANSIENT_PATTERN" "$log"; then
    echo "Transient bun audit error (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${SLEEP_SECONDS}s..." >&2
    sleep "$SLEEP_SECONDS"
    attempt=$((attempt + 1))
    continue
  fi

  exit "$status"
done

exit 1
