#!/usr/bin/env bash
# Generate an extracted-tree manifest for a pretty-index-mismatch-ci
# output directory. Used by the CI workflow on failure to guarantee an
# `extracted-tree.txt` (human) + `extracted-tree.json` (schema-checked)
# artifact always exists — even when the tarball extraction itself
# crashed before any files landed on disk.
#
# Usage:
#   scripts/ci/pi-ci-extracted-tree-manifest.sh <out-dir>
#
# Exit code is always 0. Two files are written under <out-dir>:
#   extracted-tree.txt   human-readable listing (size<TAB>path)
#   extracted-tree.json  { schema, generated_at, root, entries[], content_hash }
# The JSON manifest is what E2E tests / CI diffs consume via
# scripts/ci/pi-ci-manifest-schema-check.sh — its content_hash lets CI
# detect when artifacts changed between runs even with the same inputs.
set -u
set -o pipefail

out="${1:?usage: $0 <out-dir>}"
mf="$out/extracted-tree.txt"
jf="$out/extracted-tree.json"
mkdir -p "$out"
# Touch first so the manifests ALWAYS exist — even if the block below
# crashes halfway, the upload step finds (possibly empty) files at the
# expected paths instead of a missing artifact.
: > "$mf"
: > "$jf"

# ---------- text manifest ----------
walk_ok=1
{
  echo "# extracted-tree for $out (generated on assertion/step failure)"
  echo "# generated-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '# format: <size-bytes>\\t<path-relative-to-%s>\n' "$out"
  if [ -d "$out" ]; then
    if ! (cd "$out" && find . -type f 2>/dev/null | sort | while read -r f; do
        sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
        printf "%s\t%s\n" "$sz" "$f"
      done); then
      echo "# (find failed for $out)"
      walk_ok=0
    fi
  else
    echo "# (directory $out does not exist)"
    walk_ok=0
  fi
} >> "$mf" 2>/dev/null || true

# ---------- JSON manifest (schema v1) ----------
# content_hash = sha256 over "<size>\t<relpath>\n" lines (sorted). Same
# inputs → same hash; any file change flips it.
gen_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
tmp_entries="$(mktemp 2>/dev/null || echo "$out/.entries.$$")"
: > "$tmp_entries"
if [ -d "$out" ]; then
  (cd "$out" && find . -type f 2>/dev/null | sort | while read -r f; do
     sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
     printf "%s\t%s\n" "$sz" "$f"
   done) > "$tmp_entries" 2>/dev/null || walk_ok=0
fi

if command -v sha256sum >/dev/null 2>&1; then
  content_hash="sha256:$(sha256sum < "$tmp_entries" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  content_hash="sha256:$(shasum -a 256 < "$tmp_entries" | awk '{print $1}')"
else
  content_hash="none:unavailable"
fi

# Build entries JSON array without jq (portable).
entries_json="[]"
if [ -s "$tmp_entries" ]; then
  entries_json="$(awk -F'\t' 'BEGIN{first=1; printf "["}
    { gsub(/\\/,"\\\\",$2); gsub(/"/,"\\\"",$2);
      if(!first) printf ",";
      printf "{\"size\":%s,\"path\":\"%s\"}", $1, $2;
      first=0 }
    END{printf "]"}' "$tmp_entries")"
fi
rm -f -- "$tmp_entries" 2>/dev/null || true

printf '{"schema":"pi-ci/extracted-tree/v1","generated_at":"%s","root":"%s","walk_ok":%s,"content_hash":"%s","entries":%s}\n' \
  "$gen_at" "$out" "$([ "$walk_ok" = 1 ] && echo true || echo false)" "$content_hash" "$entries_json" \
  > "$jf" 2>/dev/null || true

echo "wrote $mf"
echo "wrote $jf"
cat "$mf" 2>/dev/null || true
exit 0
