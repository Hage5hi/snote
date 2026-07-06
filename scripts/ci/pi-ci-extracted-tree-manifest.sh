#!/usr/bin/env bash
# Generate an extracted-tree manifest for a pretty-index-mismatch-ci
# output directory. Used by the CI workflow on failure to guarantee an
# `extracted-tree.txt` artifact always exists — even when the tarball
# extraction itself crashed before any files landed on disk.
#
# Usage:
#   scripts/ci/pi-ci-extracted-tree-manifest.sh <out-dir>
#
# Exit code is always 0. The manifest file is created (possibly empty)
# under <out-dir>/extracted-tree.txt so the failure-run artifact upload
# never becomes inconsistent between runs.
set -u

out="${1:?usage: $0 <out-dir>}"
mf="$out/extracted-tree.txt"
mkdir -p "$out"
# Touch first so the manifest ALWAYS exists — even if the block below
# crashes halfway, the upload step finds a (possibly empty) file at the
# expected path instead of a missing artifact.
: > "$mf"
{
  echo "# extracted-tree for $out (generated on assertion/step failure)"
  echo "# generated-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '# format: <size-bytes>\\t<path-relative-to-%s>\n' "$out"
  if [ -d "$out" ]; then
    (cd "$out" && find . -type f 2>/dev/null | sort | while read -r f; do
      sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
      printf "%s\t%s\n" "$sz" "$f"
    done) || echo "# (find failed for $out)"
  else
    echo "# (directory $out does not exist)"
  fi
} >> "$mf" 2>/dev/null || true
echo "wrote $mf"
cat "$mf" 2>/dev/null || true
exit 0
