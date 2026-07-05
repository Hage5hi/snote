#!/usr/bin/env bash
# schema-drift-view — pretty-print the drift bundle written by
# `bun run schema-guard` (or the CI schema-guard workflow's `schema-drift`
# artifact once unzipped into ./_schema_drift/).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/schema-drift-view.sh [POSITIONAL] [FLAGS]

Positional (optional):
  all | types | schemas          Shorthand for --type

Flags:
  --type    schemas|types|all    Restrict to schema JSON diffs, types.gen.ts diff, or both.
  --file    <substr>             Show only files whose name contains <substr>.
                                 Repeatable. Also accepts comma-separated values.
  --exclude <substr>             Skip files whose name contains <substr>. Applied AFTER
                                 --file. Repeatable + comma-separated. Useful for hiding
                                 noisy bases without changing --type.
  --browsers <list>              Comma-separated Playwright projects (chromium,firefox,webkit)
                                 to scope manifest + diff/viewer output to. Repeatable.
                                 Default: all browsers.
  --viewer  auto|diff-y|delta|bat|cat
                                 Force a viewer. `auto` (default) picks diff -y when the
                                 terminal is ≥180 cols, else delta, then bat, then cat.
  --dry-run                      Print which files would match and the diff/view command
                                 that would run — no file reads, no bundle required.
  --verbose                      Trace matched files, the resolved viewer command per
                                 file, and echo executed subprocess output to stderr.
  --manifest-dir <dir>           Write JSON manifests (one per browser) into <dir>.
                                 Enables manifest emission. Default: disabled.
  --manifest-prefix <str>        Filename prefix for manifests.
                                 Per-browser: <prefix>-<browser>.json.
                                 Combined:    <prefix>-combined.json.
                                 Default: schema-drift-manifest
  --combined-manifest            Also write a single combined manifest across all
                                 selected browsers (requires --manifest-dir).
  --require <list>               Comma-separated (or repeatable) list of expected
                                 CI artifact filenames (e.g., trace.zip,failure.png)
                                 that downstream CI should require per matched
                                 browser. Persisted into the manifest as
                                 `requiredArtifacts`. Default: empty.
  --validate-manifest            Instead of running diff/viewer, validate every
                                 <prefix>-*.json in --manifest-dir for the required
                                 top-level keys and exit non-zero on any missing
                                 key. Requires --manifest-dir.
  --strict-manifest              Like --validate-manifest, but ALSO fails on any
                                 extra unknown top-level keys or on any key whose
                                 value has the wrong type (e.g., matches must be
                                 string[], combined must be boolean). Required
                                 keys AND property types are read from the shipped
                                 JSON Schema at schemas/schema-drift-manifest.schema.json
                                 (override via SCHEMA_PATH env).
  --validation-report <path>     Write a machine-readable JSON report of every
                                 checked file with { missing, mistyped, extra,
                                 parseError, ok } — useful for CI to consume.
  --require-valid                Run --validate-manifest (or --strict-manifest)
                                 FIRST; only proceed to diff/viewer output if
                                 validation succeeds. Skips diff/viewer with a
                                 non-zero exit on any validation failure.
                                 Default in CI (SCHEMA_DRIFT_REQUIRE_VALID=1).
  -h, --help                     Show this help.


Env:
  OUT                            Drift bundle directory. Default: _schema_drift

Examples:
  # All diffs, auto viewer (side-by-side if the terminal is wide enough)
  scripts/schema-drift-view.sh

  # Only the .types.gen.ts diff
  scripts/schema-drift-view.sh --type types
  scripts/schema-drift-view.sh types            # positional shorthand

  # Only the two schema JSON diffs
  scripts/schema-drift-view.sh --type schemas

  # Filter by substring (repeatable + comma-separated both work)
  scripts/schema-drift-view.sh --file report
  scripts/schema-drift-view.sh --file report --file diff
  scripts/schema-drift-view.sh --file report,diff

  # Force a specific viewer regardless of terminal width
  scripts/schema-drift-view.sh --viewer diff-y
  scripts/schema-drift-view.sh --viewer delta
  scripts/schema-drift-view.sh --viewer bat
  scripts/schema-drift-view.sh --viewer cat

  # Point at an unzipped CI artifact
  OUT=./downloads/schema-drift scripts/schema-drift-view.sh --type schemas
EOF
}

OUT="${OUT:-_schema_drift}"
FILTER="all"
FILE_MATCHES=()     # each entry is one substring
FILE_EXCLUDES=()    # each entry is one substring to skip
BROWSERS=()         # each entry is one playwright project name
VIEWER="auto"
DRY_RUN=0
VERBOSE=0
MANIFEST_DIR=""
MANIFEST_PREFIX="schema-drift-manifest"
COMBINED_MANIFEST=0
REQUIRED_ARTIFACTS=()   # expected CI artifact filenames per browser
VALIDATE_MANIFEST=0
STRICT_MANIFEST=0
VALIDATION_REPORT=""
# Default-on in CI so any drift/viewer step is gated on strict validation.
REQUIRE_VALID="${SCHEMA_DRIFT_REQUIRE_VALID:-0}"
MATCHED_BASES=()    # populated by show() as it visits each base


add_to() {
  # $1 = nameref array, $2 = comma-list
  local -n _arr=$1
  local IFS=,
  # shellcheck disable=SC2206
  local parts=($2)
  for p in "${parts[@]}"; do [ -n "$p" ] && _arr+=("$p"); done
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file)       add_to FILE_MATCHES  "${2:-}"; shift 2 ;;
    --file=*)     add_to FILE_MATCHES  "${1#*=}"; shift ;;
    --exclude)    add_to FILE_EXCLUDES "${2:-}"; shift 2 ;;
    --exclude=*)  add_to FILE_EXCLUDES "${1#*=}"; shift ;;
    --browsers)   add_to BROWSERS      "${2:-}"; shift 2 ;;
    --browsers=*) add_to BROWSERS      "${1#*=}"; shift ;;
    --type)       FILTER="${2:-all}"; shift 2 ;;
    --type=*)     FILTER="${1#*=}"; shift ;;
    --viewer)     VIEWER="${2:-auto}"; shift 2 ;;
    --viewer=*)   VIEWER="${1#*=}"; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --verbose|-v) VERBOSE=1; shift ;;
    --manifest-dir)      MANIFEST_DIR="${2:-}"; shift 2 ;;
    --manifest-dir=*)    MANIFEST_DIR="${1#*=}"; shift ;;
    --manifest-prefix)   MANIFEST_PREFIX="${2:-schema-drift-manifest}"; shift 2 ;;
    --manifest-prefix=*) MANIFEST_PREFIX="${1#*=}"; shift ;;
    --combined-manifest) COMBINED_MANIFEST=1; shift ;;
    --require)    add_to REQUIRED_ARTIFACTS "${2:-}"; shift 2 ;;
    --require=*)  add_to REQUIRED_ARTIFACTS "${1#*=}"; shift ;;
    --validate-manifest) VALIDATE_MANIFEST=1; shift ;;
    --strict-manifest)   STRICT_MANIFEST=1; VALIDATE_MANIFEST=1; shift ;;
    --validation-report)   VALIDATION_REPORT="${2:-}"; shift 2 ;;
    --validation-report=*) VALIDATION_REPORT="${1#*=}"; shift ;;
    --require-valid)       REQUIRE_VALID=1; shift ;;

    -h|--help)    usage; exit 0 ;;
    all|types|schemas) FILTER="$1"; shift ;;
    *) echo "unknown arg: $1" >&2; echo "" >&2; usage >&2; exit 2 ;;
  esac
done
[ "$FILTER" = "schema" ] && FILTER="schemas"
[ "$FILTER" = "type" ]   && FILTER="types"

vlog() { [ "$VERBOSE" = "1" ] && echo "[verbose] $*" >&2 || true; }
# --validate-manifest short-circuits the whole pipeline: verify every
# <prefix>-*.json under --manifest-dir has the required top-level keys
# (and correct value types under --strict-manifest), print a per-file
# report of missing/extra/mistyped keys, and exit BEFORE any diff/viewer
# step runs.
if [ "$VALIDATE_MANIFEST" = "1" ]; then
  if [ -z "$MANIFEST_DIR" ]; then
    echo "--validate-manifest requires --manifest-dir <dir>" >&2; exit 2
  fi
  if [ ! -d "$MANIFEST_DIR" ]; then
    echo "--validate-manifest: no such dir: $MANIFEST_DIR" >&2; exit 1
  fi
  # Locate the shipped JSON Schema (schemas/schema-drift-manifest.schema.json)
  # relative to this script. If it's missing we fail loudly — --strict-manifest
  # is documented to derive its checks from the schema.
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  SCHEMA_PATH="${SCHEMA_PATH:-$SCRIPT_DIR/../schemas/schema-drift-manifest.schema.json}"
  MANIFEST_DIR="$MANIFEST_DIR" MANIFEST_PREFIX="$MANIFEST_PREFIX" \
    STRICT="$STRICT_MANIFEST" REPORT="$VALIDATION_REPORT" \
    SCHEMA_PATH="$SCHEMA_PATH" node -e '
    const fs=require("fs"),path=require("path");
    const dir=process.env.MANIFEST_DIR, pref=process.env.MANIFEST_PREFIX;
    const strict=process.env.STRICT==="1";
    const reportPath=process.env.REPORT||"";
    const schemaPath=process.env.SCHEMA_PATH;
    let schema;
    try { schema=JSON.parse(fs.readFileSync(schemaPath,"utf8")); }
    catch (e) { console.error(`cannot load schema at ${schemaPath}: ${e.message}`); process.exit(2); }
    const REQUIRED=schema.required||[];
    const PROPS=schema.properties||{};
    const KNOWN=new Set(Object.keys(PROPS));
    // Convert a JSON-Schema property node to a compact type label used in
    // error messages: "string" | "boolean" | "string[]" | "<t>[]".
    const labelOf=p=>{
      if (!p) return "unknown";
      if (p.type==="array") {
        const it=p.items&&p.items.type ? p.items.type : "any";
        return `${it}[]`;
      }
      return p.type||"unknown";
    };
    // Actual type of a JS value, matching the label vocabulary above.
    const typeOfVal=v=>{
      if (Array.isArray(v)) {
        if (v.length===0) return "string[]"; // empty ⇒ satisfies string[]
        const ts=new Set(v.map(x=>Array.isArray(x)?"array":typeof x));
        return ts.size===1 ? `${[...ts][0]}[]` : "array";
      }
      return typeof v;
    };
    const files=fs.readdirSync(dir)
      .filter(f=>f.startsWith(pref+"-")&&f.endsWith(".json"))
      .sort();
    if (files.length===0) {
      console.error(`--validate-manifest: no manifests matched ${pref}-*.json in ${dir}`);
      process.exit(1);
    }
    // Machine-readable report accumulator.
    const report={
      generatedAt: new Date().toISOString().replace(/\.\d+Z$/,"Z"),
      strict, schemaPath, files: [],
      totals: { checked: 0, ok: 0, invalid: 0 },
    };
    let bad=0;
    for (const f of files) {
      const p=path.join(dir,f);
      const entry={ path: p, ok: true, missing: [], mistyped: [], extra: [], parseError: null };
      let doc;
      try { doc=JSON.parse(fs.readFileSync(p,"utf8")); }
      catch (e) {
        entry.ok=false; entry.parseError=e.message;
        console.error(`INVALID ${p} — malformed JSON: ${e.message}`);
        bad++; report.files.push(entry); continue;
      }
      entry.browser = doc.browser || null;
      entry.combined = doc.combined === true;
      for (const k of REQUIRED) {
        if (!(k in doc)) { entry.missing.push(k); continue; }
        const want=labelOf(PROPS[k]);
        const got=typeOfVal(doc[k]);
        if (got!==want) entry.mistyped.push({ key: k, expected: want, got });
      }
      if (strict) for (const k of Object.keys(doc)) if (!KNOWN.has(k)) entry.extra.push(k);
      const problems=[];
      if (entry.missing.length)  problems.push(`missing: ${entry.missing.join(", ")}`);
      if (entry.mistyped.length) problems.push(`mistyped: ${entry.mistyped.map(m=>`${m.key} (expected ${m.expected}, got ${m.got})`).join(", ")}`);
      if (entry.extra.length)    problems.push(`extra: ${entry.extra.join(", ")}`);
      const label=entry.combined ? "[combined] " : `[browser=${entry.browser||"?"}] `;
      if (problems.length) {
        entry.ok=false; bad++;
        console.error(`INVALID ${p} ${label}— ${problems.join(" | ")}`);
      } else {
        console.log(`OK      ${p} ${label}`);
      }
      report.files.push(entry);
    }
    report.totals.checked=files.length;
    report.totals.invalid=bad;
    report.totals.ok=files.length-bad;
    if (reportPath) {
      fs.mkdirSync(path.dirname(path.resolve(reportPath)),{recursive:true});
      fs.writeFileSync(reportPath, JSON.stringify(report,null,2));
      console.log(`report: ${reportPath}`);
    }
    if (bad>0) {
      console.error(`--validate-manifest: ${bad}/${files.length} manifest(s) failed (strict=${strict})`);
      process.exit(1);
    }
  '
  exit $?
fi

# --dry-run must work without a bundle on disk so it's usable as a
# planning/preview step and in unit tests. All other modes require OUT.
if [ ! -d "$OUT" ] && [ "$DRY_RUN" != "1" ]; then
  echo "no drift bundle at $OUT — run: bun run schema-guard" >&2
  exit 1
fi

COLS=$(tput cols 2>/dev/null || echo 160)
resolve_viewer() {
  case "$VIEWER" in
    diff-y|diff|side-by-side) echo "diff-y" ;;
    delta) command -v delta >/dev/null && echo "delta" || echo "cat" ;;
    bat)   command -v bat   >/dev/null && echo "bat"   || echo "cat" ;;
    cat)   echo "cat" ;;
    auto)
      if [ "$COLS" -ge 180 ]; then echo "diff-y"
      elif command -v delta >/dev/null 2>&1; then echo "delta"
      elif command -v bat   >/dev/null 2>&1; then echo "bat"
      else echo "cat"; fi ;;
    *) echo "unknown --viewer: $VIEWER" >&2; exit 2 ;;
  esac
}
RESOLVED_VIEWER="$(resolve_viewer)"

pretty() {
  case "$RESOLVED_VIEWER" in
    delta) delta --side-by-side --width "$COLS" ;;
    bat)   bat -l diff --paging=never ;;
    *)     cat ;;
  esac
}

matches_filter() {
  local base="$1" m
  # --exclude wins over --file (skip if any exclude matches).
  for m in "${FILE_EXCLUDES[@]}"; do
    [[ "$base" == *"$m"* ]] && return 1
  done
  # No --file filters ⇒ everything passes.
  [ "${#FILE_MATCHES[@]}" -eq 0 ] && return 0
  for m in "${FILE_MATCHES[@]}"; do
    [[ "$base" == *"$m"* ]] && return 0
  done
  return 1
}

show() {
  local base="$1"
  if ! matches_filter "$base"; then
    vlog "skip $base (--file/--exclude filter)"
    [ "$DRY_RUN" = "1" ] && echo "SKIP  $base  (filtered by --file/--exclude)"
    return 0
  fi
  MATCHED_BASES+=("$base")
  local committed="$OUT/committed/$base"
  local regen="$OUT/regenerated/$base"
  local diff_file="$OUT/${base}.diff"

  local cmd
  if [ "$RESOLVED_VIEWER" = "diff-y" ]; then
    cmd="diff -y --width=$COLS $committed $regen"
  else
    cmd="pretty($RESOLVED_VIEWER) < $diff_file"
  fi
  vlog "match $base → $cmd"

  if [ "$DRY_RUN" = "1" ]; then
    echo "MATCH $base  →  $cmd"
    return 0
  fi

  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  $base   [viewer=$RESOLVED_VIEWER]"
  echo "══════════════════════════════════════════════════════════════"

  if [ ! -s "$diff_file" ]; then
    echo "  (no drift for this file)"
    return
  fi

  if [ "$RESOLVED_VIEWER" = "diff-y" ] && [ -s "$committed" ] && [ -s "$regen" ]; then
    if [ "$VERBOSE" = "1" ]; then
      diff -y --width="$COLS" "$committed" "$regen" | tee /dev/stderr || true
    else
      diff -y --width="$COLS" "$committed" "$regen" || true
    fi
  else
    if [ "$VERBOSE" = "1" ]; then
      pretty < "$diff_file" | tee /dev/stderr
    else
      pretty < "$diff_file"
    fi
  fi
}

case "$FILTER" in
  types)   show "focus-trap-inspect-schema.types.gen.ts" ;;
  schemas) show "focus-trap-inspect-report.schema.json"
           show "focus-trap-inspect-diff.schema.json" ;;
  all|"")  show "focus-trap-inspect-report.schema.json"
           show "focus-trap-inspect-diff.schema.json"
           show "focus-trap-inspect-schema.types.gen.ts" ;;
  *) echo "unknown --type: $FILTER" >&2; usage >&2; exit 2 ;;
esac

if [ "$DRY_RUN" != "1" ] && [ -s "$OUT/cli-schema-versions.txt" ]; then
  echo ""
  echo "── CLI SCHEMA_VERSION consts ──────────────────────────────────"
  cat "$OUT/cli-schema-versions.txt"
fi
echo ""
files_str="${FILE_MATCHES[*]:-<none>}"
excludes_str="${FILE_EXCLUDES[*]:-<none>}"
browsers_str="${BROWSERS[*]:-<all>}"
required_str="${REQUIRED_ARTIFACTS[*]:-<none>}"
echo "Bundle: $OUT/  (viewer=$RESOLVED_VIEWER, cols=$COLS, type=$FILTER, files=[${files_str}], exclude=[${excludes_str}], browsers=[${browsers_str}], required=[${required_str}], verbose=${VERBOSE})"

# ── JSON manifest emission ────────────────────────────────────────
# Enabled when --manifest-dir is set. One file per selected browser
# (or a single "<all>" entry when --browsers is unset), plus an
# optional combined file across every selected browser.
if [ -n "$MANIFEST_DIR" ]; then
  mkdir -p "$MANIFEST_DIR"
  # JSON-array helper: prints ["a","b"] from array positional args.
  json_arr() {
    local first=1 s='['
    for x in "$@"; do
      [ $first -eq 1 ] || s+=','
      first=0
      # Escape backslashes and double-quotes for safe JSON embedding.
      local esc="${x//\\/\\\\}"; esc="${esc//\"/\\\"}"
      s+="\"$esc\""
    done
    s+=']'
    printf '%s' "$s"
  }
  case "$FILTER" in
    types)   EXPECTED_BASES=("focus-trap-inspect-schema.types.gen.ts") ;;
    schemas) EXPECTED_BASES=("focus-trap-inspect-report.schema.json"
                             "focus-trap-inspect-diff.schema.json") ;;
    *)       EXPECTED_BASES=("focus-trap-inspect-report.schema.json"
                             "focus-trap-inspect-diff.schema.json"
                             "focus-trap-inspect-schema.types.gen.ts") ;;
  esac
  if [ "$RESOLVED_VIEWER" = "diff-y" ]; then
    VIEWER_CMD="diff -y --width=$COLS <committed> <regenerated>"
  else
    VIEWER_CMD="pretty($RESOLVED_VIEWER) < <base>.diff"
  fi
  # De-dupe MATCHED_BASES (show() may be called >1x per run).
  MATCHED_UNIQUE=(); declare -A _seen=()
  for b in "${MATCHED_BASES[@]:-}"; do
    [ -z "$b" ] && continue
    [ -n "${_seen[$b]:-}" ] && continue
    _seen[$b]=1; MATCHED_UNIQUE+=("$b")
  done

  GEN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  SEL_BROWSERS=("${BROWSERS[@]:-<all>}")

  write_manifest() {
    # $1 = output path, $2 = browser label, $3 = "1" if combined
    local path="$1" browser="$2" combined="$3"
    local browsers_json
    if [ "$combined" = "1" ]; then
      browsers_json="$(json_arr "${SEL_BROWSERS[@]}")"
    else
      browsers_json="$(json_arr "$browser")"
    fi
    {
      printf '{\n'
      printf '  "browser": %s,\n'         "$(json_arr "$browser" | sed 's/^\[//; s/\]$//')"
      printf '  "browsers": %s,\n'        "$browsers_json"
      printf '  "combined": %s,\n'        "$([ "$combined" = "1" ] && echo true || echo false)"
      printf '  "generatedAt": "%s",\n'   "$GEN_AT"
      printf '  "type": "%s",\n'          "$FILTER"
      printf '  "viewer": "%s",\n'        "$RESOLVED_VIEWER"
      printf '  "resolvedViewerCommand": "%s",\n' "$VIEWER_CMD"
      printf '  "matches": %s,\n'         "$(json_arr "${FILE_MATCHES[@]:-}")"
      printf '  "excludes": %s,\n'        "$(json_arr "${FILE_EXCLUDES[@]:-}")"
      printf '  "expected": %s,\n'        "$(json_arr "${EXPECTED_BASES[@]}")"
      printf '  "requiredArtifacts": %s,\n' "$(json_arr "${REQUIRED_ARTIFACTS[@]:-}")"
      printf '  "matched": %s\n'          "$(json_arr "${MATCHED_UNIQUE[@]:-}")"
      printf '}\n'
    } > "$path"
    echo "manifest: $path"
    vlog "wrote manifest $path"
  }

  # Per-browser manifests (or a single "<all>" file when unset).
  if [ "${#BROWSERS[@]}" -eq 0 ]; then
    write_manifest "$MANIFEST_DIR/${MANIFEST_PREFIX}-all.json" "<all>" 0
  else
    for b in "${BROWSERS[@]}"; do
      write_manifest "$MANIFEST_DIR/${MANIFEST_PREFIX}-${b}.json" "$b" 0
    done
  fi

  # Combined manifest across all selected browsers.
  if [ "$COMBINED_MANIFEST" = "1" ]; then
    write_manifest "$MANIFEST_DIR/${MANIFEST_PREFIX}-combined.json" "combined" 1
  fi
fi
