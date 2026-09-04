#!/usr/bin/env bash
# Extension security audit:
#  - fails on high/critical advisories across the pinned lockfile
#  - lints the extension source with ESLint
#  - enforces a permission whitelist on chrome-extension/manifest.json so
#    a stray "tabs", "history", "cookies", "<all_urls>" etc. can't sneak in.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ bun audit (full lockfile, high+)"
bash "$ROOT/scripts/retry-bun-audit.sh"

echo "▶ ESLint on chrome-extension/"
bunx eslint chrome-extension --ext .js,.ts --max-warnings=0

echo "▶ Manifest permission whitelist"
node --input-type=module -e '
  import fs from "node:fs";
  const m = JSON.parse(fs.readFileSync("chrome-extension/manifest.json", "utf8"));
  const ALLOWED_PERMS = new Set(["sidePanel", "storage"]);
  const perms = m.permissions ?? [];
  const bad = perms.filter((p) => !ALLOWED_PERMS.has(p));
  if (bad.length) {
    console.error("✗ disallowed extension permission(s):", bad.join(", "));
    process.exit(1);
  }
  if (m.host_permissions?.length) {
    console.error("✗ host_permissions must be empty (found:", m.host_permissions.join(", "), ")");
    process.exit(1);
  }
  const csp = m.content_security_policy?.extension_pages ?? "";
  if (!/script-src '\''self'\''/.test(csp)) {
    console.error("✗ manifest CSP must pin script-src to '\''self'\''");
    process.exit(1);
  }
  console.log("✓ manifest permissions ok:", perms.join(", ") || "(none)");
'

echo "✅ extension audit passed"
