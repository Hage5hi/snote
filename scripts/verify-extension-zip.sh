#!/usr/bin/env bash
# Drift guard for the shipped chrome-extension zip.
#
# Compares public/syrin-note-sidepanel.zip against
# public/syrin-note-sidepanel.zip.manifest.json (byte size + sha256 + version)
# AND asserts that the version inside the zipped manifest.json matches the
# version in chrome-extension/manifest.json (the source of truth).
#
# Fails (exit 1) with a diff-style message on any drift so CI blocks merges
# that ship a stale zip.
set -euo pipefail

ZIP="public/syrin-note-sidepanel.zip"
META="public/syrin-note-sidepanel.zip.manifest.json"
SRC_MANIFEST="chrome-extension/manifest.json"

for f in "$ZIP" "$META" "$SRC_MANIFEST"; do
  [[ -f "$f" ]] || { echo "verify-extension-zip: missing $f" >&2; exit 1; }
done

expected_version=$(jq -r '.version' "$META")
expected_bytes=$(jq -r '.bytes' "$META")
expected_sha=$(jq -r '.sha256' "$META")

actual_bytes=$(stat -c '%s' "$ZIP" 2>/dev/null || stat -f '%z' "$ZIP")
actual_sha=$(sha256sum "$ZIP" | awk '{print $1}')
zip_version=$(unzip -p "$ZIP" manifest.json | jq -r '.version')
src_version=$(jq -r '.version' "$SRC_MANIFEST")

fail=0
diff_row() { printf '  %-14s expected=%s actual=%s\n' "$1" "$2" "$3" >&2; }

if [[ "$src_version" != "$expected_version" ]]; then
  echo "verify-extension-zip: source manifest version drift" >&2
  diff_row "version" "$expected_version" "$src_version"
  fail=1
fi
if [[ "$zip_version" != "$expected_version" ]]; then
  echo "verify-extension-zip: zipped manifest version drift" >&2
  diff_row "zip.version" "$expected_version" "$zip_version"
  fail=1
fi
if [[ "$actual_bytes" != "$expected_bytes" ]]; then
  echo "verify-extension-zip: byte size drift" >&2
  diff_row "bytes" "$expected_bytes" "$actual_bytes"
  fail=1
fi
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "verify-extension-zip: sha256 drift" >&2
  diff_row "sha256" "$expected_sha" "$actual_sha"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "Rebuild the zip from chrome-extension/ and update $META, then re-run this script." >&2
  exit 1
fi

echo "verify-extension-zip: OK (version=$expected_version bytes=$expected_bytes)"
