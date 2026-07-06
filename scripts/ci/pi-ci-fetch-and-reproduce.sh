#!/usr/bin/env bash
# Download a pi-ci schema-validation failure artifact from a CI run, then
# automatically hand the extracted report-schema-validation-summary.json
# to scripts/ci/pi-ci-reproduce-jq-failure.sh — with the input paths,
# stderr sidecars, and jq_timeout_secs it recorded.
#
# Usage:
#   scripts/ci/pi-ci-fetch-and-reproduce.sh <run-id> [flags]
#
# Flags:
#   --scope <atomic|stress>   Which matrix to fetch (default: atomic).
#   --os <linux|macos|...>    OS suffix on the artifact name (default: linux).
#   --repo <owner/name>       Repo slug (default: `gh repo view` current).
#   --dest <dir>              Where to extract (default: mktemp -d).
#   --run                     Actually execute the rerun (passes --run through).
#   -h | --help               Show this help.
#
# Requires the GitHub CLI (`gh`) authenticated for the target repo.
set -euo pipefail

usage() { sed -n '2,20p' "$0"; }

run_id=""
scope="atomic"
os="linux"
repo=""
dest=""
do_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --scope) scope="${2:?}"; shift 2 ;;
    --os)    os="${2:?}";    shift 2 ;;
    --repo)  repo="${2:?}";  shift 2 ;;
    --dest)  dest="${2:?}";  shift 2 ;;
    --run)   do_run=1;       shift ;;
    -*) echo "ERROR: unknown flag: $1" >&2; usage; exit 2 ;;
    *)  [ -z "$run_id" ] && run_id="$1" || { echo "ERROR: unexpected arg: $1" >&2; exit 2; }
        shift ;;
  esac
done

[ -n "$run_id" ] || { echo "ERROR: missing <run-id>" >&2; usage; exit 2; }
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required" >&2; exit 2; }

here="$(cd -- "$(dirname -- "$0")" && pwd)"
repro="$here/pi-ci-reproduce-jq-failure.sh"
[ -x "$repro" ] || { echo "ERROR: repro script not executable: $repro" >&2; exit 2; }

[ -n "$dest" ] || dest="$(mktemp -d -t pi-ci-fetch.XXXXXX)"
mkdir -p "$dest"

# Try the dedicated I/O artifact first (has stderr sidecars), fall back
# to the broader failure bundle.
artifact_candidates=(
  "pretty-index-mismatch-ci-schema-validator-io-${scope}-${os}"
  "pretty-index-mismatch-ci-report-schema-failure-${scope}-${os}"
  "pretty-index-mismatch-ci-report-schema-validation-log-${scope}-${os}"
)

download_args=(run download "$run_id" --dir "$dest")
[ -n "$repo" ] && download_args+=(--repo "$repo")

fetched=""
for a in "${artifact_candidates[@]}"; do
  echo "── attempting: $a ──"
  if gh "${download_args[@]}" --name "$a" 2>/tmp/gh-err.$$; then
    fetched="$a"; break
  else
    cat /tmp/gh-err.$$ >&2 || true
  fi
done
rm -f /tmp/gh-err.$$
if [ -z "$fetched" ]; then
  echo "ERROR: no matching CI failure artifact found for run $run_id" >&2
  echo "       tried: ${artifact_candidates[*]}" >&2
  exit 3
fi

echo "fetched artifact: $fetched"
echo "extracted to:     $dest"

summary="$(find "$dest" -maxdepth 3 -name 'report-schema-validation-summary.json' -print -quit)"
if [ -z "$summary" ] || [ ! -s "$summary" ]; then
  echo "ERROR: report-schema-validation-summary.json not found (or empty) under $dest" >&2
  echo "       artifact '$fetched' appears incomplete — re-run the CI job or pick a newer run" >&2
  exit 4
fi
echo "summary:          $summary"

# Verify each recorded jq_stderr_path sidecar actually landed in the download.
# A missing sidecar defeats the purpose of the reproduction, so fail loudly.
missing_sidecars=()
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  base="$(basename "$rel")"
  hit="$(find "$dest" -maxdepth 4 -name "$base" -print -quit)"
  [ -n "$hit" ] || missing_sidecars+=("$base")
done < <(jq -r '.files[]?.jq_stderr_path // empty' "$summary")
if [ ${#missing_sidecars[@]} -gt 0 ]; then
  echo "ERROR: summary references sidecars that are missing from the artifact:" >&2
  for m in "${missing_sidecars[@]}"; do echo "         - $m" >&2; done
  echo "       download the '…-schema-validator-io-…' artifact for this run and retry" >&2
  exit 5
fi

# Pull jq_timeout_secs from the summary so the rerun uses the same value.
tsecs="$(jq -r '.jq_timeout_secs // empty' "$summary")"


repro_flags=()
[ -n "$tsecs" ] && repro_flags+=(--jq-timeout-secs "$tsecs")
[ "$do_run" = 1 ] && repro_flags+=(--run)

# Feed each recorded input path through as an --input filter so the
# rerun targets exactly the failing files even if the summary contains
# multiple rows.
while IFS= read -r p; do
  [ -n "$p" ] && repro_flags+=(--input "$p")
done < <(jq -r '.files[] | select(.reason | startswith("jq-") or . == "schema-drift" or startswith("schema_version-")) | .path' "$summary")

echo
echo "── invoking pi-ci-reproduce-jq-failure.sh ──"
exec "$repro" "$summary" "${repro_flags[@]}"
