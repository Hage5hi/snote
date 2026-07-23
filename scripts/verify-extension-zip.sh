#!/usr/bin/env bash
set -euo pipefail
exec bun run scripts/verify-extension-zip.ts
