# Lovable dev Makefile — convenience targets around the pretty-index
# schema-drift check flow. All targets shell out to the same scripts CI
# runs, so `make pretty-index-check` locally == the CI job.
#
# Variables:
#   INDEX    Path to the pretty-index.json under check.
#            Defaults to the CI matrices' path.
SHELL := /usr/bin/env bash

INDEX ?= artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json
MATRIX ?= atomic
PRE    = $(INDEX:.json=.pre-check.json)
REPORT = $(INDEX:.json=.report.json)

# Scope selector for the download-flow targets (verify, verify-summary,
# hook-validate-downloaded, reproduce-downloaded, download-verify-reproduce).
# Independent of MATRIX so it doesn't collide with the single-run default.
#   atomic | stress | both     (default: both)
PI_SCOPE ?= both

# Local file where verify targets write a machine-readable
# checksum-mismatch report on failure. PI_REPORT_PATH is the canonical
# knob; PI_MISMATCH_REPORT is kept as a back-compat alias.
PI_MISMATCH_REPORT ?= _pretty-index-checksum-mismatch.json
PI_REPORT_PATH     ?= $(PI_MISMATCH_REPORT)

# Stop verify at the first per-file MISMATCH when set to 1. Default 0
# (walk every file so the report is complete).
PI_FAIL_FAST ?= 0




.PHONY: help pretty-index-check pretty-index-check-clean \
        pretty-index-check-pwsh pretty-index-diagnostics pretty-index-clean \
        pretty-index-clean-dry-run \
        pretty-index-artifacts pretty-index-hook-dry-run \
        pretty-index-artifacts-download \
        pretty-index-artifacts-verify \
        pretty-index-hook-validate-downloaded \
        pretty-index-reproduce-downloaded \
        pretty-index-artifacts-download-verify-reproduce \
        pretty-index-artifacts-clean \
        pretty-index-artifacts-verify-summary \
        pretty-index-help







help:
	@echo "Targets:"
	@echo "  pretty-index-check          Run the CI pretty-index check flow locally (Bash)."
	@echo "  pretty-index-check-clean    Same, but discard prior diagnostics first."
	@echo "  pretty-index-check-pwsh     Run the PowerShell reproduce flow (needs pwsh)."
	@echo "  pretty-index-diagnostics    Print where diagnostic artifacts are written."
	@echo "  pretty-index-clean          Remove sibling .pre-check.json / .report.json."
	@echo ""
	@echo "Overrides:"
	@echo "  INDEX=path/to/pretty-index.json     (default: CI matrix path)"
	@echo "  MATRIX=atomic|stress                (default: atomic; controls artifact prefix)"

pretty-index-check:
	@scripts/reproduce-ci-pretty-index-check.sh --matrix "$(MATRIX)" "$(INDEX)"
	@$(MAKE) --no-print-directory pretty-index-diagnostics

pretty-index-check-clean:
	@scripts/reproduce-ci-pretty-index-check.sh --clean --matrix "$(MATRIX)" "$(INDEX)"
	@$(MAKE) --no-print-directory pretty-index-diagnostics

pretty-index-check-pwsh:
	@pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Matrix "$(MATRIX)" "$(INDEX)"
	@$(MAKE) --no-print-directory pretty-index-diagnostics

pretty-index-diagnostics:
	@echo ""
	@echo "pretty-index diagnostics artifacts (current MATRIX=$(MATRIX)):"
	@echo "  input directory : $(dir $(INDEX))"
	@echo "  input           : $(INDEX)"
	@echo "  pre-check       : $(PRE)     (raw generator output, uploaded on CI failure)"
	@echo "  report JSON     : $(REPORT)  (validator --report, uploaded on CI failure)"
	@echo ""
	@echo "CI artifact names by matrix (same on-disk files, distinct upload names):"
	@echo "  atomic  -> schema-drift-diff-replay-pretty-index-failure-<os>"
	@echo "  stress  -> schema-drift-diff-stress-replay-pretty-index-failure-<os>"
	@if [ "$(MATRIX)" = "stress" ]; then \
	  echo ""; echo "==> current run uploads as the STRESS prefix"; \
	else \
	  echo ""; echo "==> current run uploads as the ATOMIC prefix"; \
	fi


pretty-index-clean:
	@rm -f -- "$(PRE)" "$(REPORT)"
	@echo "removed: $(PRE) $(REPORT)"

pretty-index-clean-dry-run:
	@echo "pretty-index-clean dry-run — the following files WOULD be removed:"
	@echo ""
	@echo "  MATRIX=atomic (artifact: schema-drift-diff-replay-pretty-index-failure-<os>)"
	@for f in "$(PRE)" "$(REPORT)"; do \
	  if [ -e "$$f" ]; then echo "    [exists] $$f"; else echo "    [absent] $$f"; fi; \
	done
	@echo ""
	@echo "  MATRIX=stress (artifact: schema-drift-diff-stress-replay-pretty-index-failure-<os>)"
	@for f in "$(PRE)" "$(REPORT)"; do \
	  if [ -e "$$f" ]; then echo "    [exists] $$f"; else echo "    [absent] $$f"; fi; \
	done
	@echo ""
	@echo "(both matrices share the same on-disk siblings; only the CI artifact upload name differs)"
	@echo "run 'make pretty-index-clean' to actually remove them."


pretty-index-artifacts:
	@echo "Expected pretty-index diagnostic artifact filenames:"
	@echo ""
	@echo "  input file  : $(INDEX)"
	@echo "  siblings    : $(PRE)"
	@echo "                $(REPORT)"
	@echo ""
	@echo "  atomic  -> uploaded as: schema-drift-diff-replay-pretty-index-failure-<os>"
	@echo "  stress  -> uploaded as: schema-drift-diff-stress-replay-pretty-index-failure-<os>"
	@echo ""
	@echo "  current MATRIX=$(MATRIX)  (override with: make pretty-index-artifacts MATRIX=stress)"


pretty-index-hook-dry-run:
	@echo "==> pre-commit hook dry-run (MATRIX=atomic)"
	@PRETTY_INDEX_HOOK_DRY_RUN=1 PRETTY_INDEX_HOOK_FORCE=1 \
	  PRETTY_INDEX_HOOK_MATRIX=atomic .githooks/pre-commit
	@echo ""
	@echo "==> pre-commit hook dry-run (MATRIX=stress)"
	@PRETTY_INDEX_HOOK_DRY_RUN=1 PRETTY_INDEX_HOOK_FORCE=1 \
	  PRETTY_INDEX_HOOK_MATRIX=stress .githooks/pre-commit
	@$(MAKE) --no-print-directory pretty-index-diagnostics

# Download BOTH matrices' pretty-index failure diagnostic artifacts from
# a failed CI run, using the exact `gh run download` commands documented
# in the README, and prepare them for local inspection under
# ./_pretty-index-<matrix>/.
#
#   make pretty-index-artifacts-download RUN_ID=<run-id> [OS=ubuntu-latest]
RUN_ID ?=
OS     ?= ubuntu-latest
pretty-index-artifacts-download:
	@if [ -z "$(RUN_ID)" ]; then \
	  echo "usage: make pretty-index-artifacts-download RUN_ID=<run-id> [OS=ubuntu-latest|macos-latest|windows-latest]" >&2; \
	  exit 2; \
	fi
	@command -v gh >/dev/null || { echo "gh CLI is required (see https://cli.github.com)" >&2; exit 2; }
	@rm -rf ./_pretty-index-atomic ./_pretty-index-stress
	@echo "==> downloading MATRIX=atomic (schema-drift-diff-replay-pretty-index-failure-$(OS))"
	@gh run download $(RUN_ID) \
	  -n schema-drift-diff-replay-pretty-index-failure-$(OS) \
	  -D ./_pretty-index-atomic
	@echo "==> downloading MATRIX=stress (schema-drift-diff-stress-replay-pretty-index-failure-$(OS))"
	@gh run download $(RUN_ID) \
	  -n schema-drift-diff-stress-replay-pretty-index-failure-$(OS) \
	  -D ./_pretty-index-stress
	@echo ""
	@echo "downloaded artifacts:"
	@ls -1 ./_pretty-index-atomic ./_pretty-index-stress 2>/dev/null || true
	@echo ""
	@echo "inspect with:  jq . ./_pretty-index-atomic/pretty-index.report.json"
	@echo "verify with:   make pretty-index-artifacts-verify"
	@echo "reproduce with: make pretty-index-hook-validate-downloaded"

# Verify sha256 checksums of the downloaded atomic/stress pretty-index
# diagnostic artifacts. Each uploaded artifact ships a sibling
# pretty-index.checksums.sha256 (computed in CI just before upload); this
# target re-runs `sha256sum -c` against the downloaded files so local
# inspection can trust the bytes.
pretty-index-artifacts-verify:
	@case "$(PI_SCOPE)" in atomic) dirs="./_pretty-index-atomic";; \
	  stress) dirs="./_pretty-index-stress";; \
	  both) dirs="./_pretty-index-atomic ./_pretty-index-stress";; \
	  *) echo "PI_SCOPE must be atomic|stress|both (got: $(PI_SCOPE))" >&2; exit 2;; esac; \
	rc=0; \
	report="$(PI_REPORT_PATH)"; \
	fail_fast="$(PI_FAIL_FAST)"; \
	mkdir -p -- "$$(dirname -- "$$report")" 2>/dev/null || true; \
	rm -f -- "$$report"; \
	first=1; stop=0; \
	printf '{"schema":"pretty-index-checksum-mismatch/v1","scope":"$(PI_SCOPE)","fail_fast":%s,"results":[' \
	  "$$( [ "$$fail_fast" = "1" ] && echo true || echo false )" > "$$report.tmp"; \
	for dir in $$dirs; do \
	  [ $$stop -eq 1 ] && break; \
	  if [ ! -d "$$dir" ]; then \
	    echo "❌ $$dir missing — run 'make pretty-index-artifacts-download RUN_ID=...' first" >&2; \
	    [ $$first -eq 1 ] || printf ',' >> "$$report.tmp"; first=0; \
	    printf '{"dir":"%s","artifact_dir":"%s","status":"dir_missing"}' "$$dir" "$$(basename -- "$$dir")" >> "$$report.tmp"; \
	    rc=2; [ "$$fail_fast" = "1" ] && stop=1; continue; \
	  fi; \
	  if [ ! -f "$$dir/pretty-index.checksums.sha256" ]; then \
	    echo "❌ $$dir/pretty-index.checksums.sha256 missing — artifact was uploaded without checksums" >&2; \
	    [ $$first -eq 1 ] || printf ',' >> "$$report.tmp"; first=0; \
	    printf '{"dir":"%s","artifact_dir":"%s","status":"checksums_missing"}' "$$dir" "$$(basename -- "$$dir")" >> "$$report.tmp"; \
	    rc=2; [ "$$fail_fast" = "1" ] && stop=1; continue; \
	  fi; \
	  echo "==> verifying $$dir"; \
	  log="$$(mktemp)"; \
	  if ! ( cd "$$dir" && sha256sum -c pretty-index.checksums.sha256 ) > "$$log" 2>&1; then \
	    cat "$$log"; \
	    echo ""; echo "── checksum mismatch detail ($$dir) ──"; \
	    while IFS= read -r line; do \
	      case "$$line" in \
	        *FAILED*|*OK*) \
	          fname="$${line%%:*}"; \
	          exp=$$(grep " $$fname$$" "$$dir/pretty-index.checksums.sha256" | awk '{print $$1}'); \
	          act=$$( ( cd "$$dir" && sha256sum "$$fname" 2>/dev/null ) | awk '{print $$1}'); \
	          if [ -z "$$act" ]; then act=""; fi; \
	          if [ "$$exp" = "$$act" ] && [ -n "$$exp" ]; then status="OK"; else status="MISMATCH"; fi; \
	          echo "  $$fname  expected=$${exp:-<none>}  actual=$${act:-<missing>}  [$$status]"; \
	          [ $$first -eq 1 ] || printf ',' >> "$$report.tmp"; first=0; \
	          adir="$$(basename -- "$$dir")"; \
	          printf '{"dir":"%s","artifact_dir":"%s","file":"%s","path":"%s/%s","expected":"%s","actual":"%s","status":"%s"}' \
	            "$$dir" "$$adir" "$$fname" "$$dir" "$$fname" "$$exp" "$$act" "$$status" >> "$$report.tmp"; \
	          if [ "$$status" = "MISMATCH" ] && [ "$$fail_fast" = "1" ]; then \
	            echo "── PI_FAIL_FAST=1: stopping after first mismatch ──"; stop=1; break; \
	          fi; \
	          ;; \
	      esac; \
	    done < "$$log"; \
	    rm -f "$$log"; \
	    rc=1; \
	  else \
	    cat "$$log"; rm -f "$$log"; \
	  fi; \
	done; \
	printf ']}\n' >> "$$report.tmp"; \
	if [ $$rc -ne 0 ]; then \
	  mv -- "$$report.tmp" "$$report"; \
	  echo ""; echo "wrote mismatch report: $$report"; \
	else \
	  rm -f -- "$$report.tmp"; \
	  echo ""; echo "✅ pretty-index artifacts verified (scope=$(PI_SCOPE))"; \
	fi; \
	exit $$rc



# Reproduce a CI failure locally by running the pre-commit hook in
# validation mode against each downloaded pretty-index directory. Copies
# the downloaded pretty-index.json into the expected on-disk path
# ($(INDEX)) and invokes the hook with PRETTY_INDEX_HOOK_FORCE=1 so it
# runs regardless of staged files, once per MATRIX.
pretty-index-hook-validate-downloaded:
	@$(MAKE) --no-print-directory pretty-index-artifacts-verify PI_SCOPE=$(PI_SCOPE)
	@mkdir -p -- "$(dir $(INDEX))"
	@case "$(PI_SCOPE)" in atomic) list="atomic";; stress) list="stress";; \
	  both) list="atomic stress";; \
	  *) echo "PI_SCOPE must be atomic|stress|both (got: $(PI_SCOPE))" >&2; exit 2;; esac; \
	rc=0; \
	for matrix in $$list; do \
	  dir="./_pretty-index-$$matrix"; \
	  if [ ! -f "$$dir/pretty-index.json" ]; then \
	    echo "❌ $$dir/pretty-index.json missing" >&2; rc=2; continue; \
	  fi; \
	  echo ""; echo "==> pre-commit hook validation (MATRIX=$$matrix) against $$dir"; \
	  cp -- "$$dir/pretty-index.json" "$(INDEX)"; \
	  PRETTY_INDEX_HOOK_FORCE=1 PRETTY_INDEX_HOOK_MATRIX=$$matrix \
	    .githooks/pre-commit || rc=1; \
	done; \
	exit $$rc

# One-command local reproduction of a CI pretty-index failure:
#   1. verify sha256 checksums of downloaded artifacts (PI_SCOPE)
#   2. run the pre-commit hook in validation mode against them
# Fails fast (exit 1) on the first checksum mismatch — the hook step is
# skipped entirely if verify fails, so you never validate corrupted bytes.
#
# PI_SCOPE=atomic|stress|both  (default: both) — restrict to one matrix.
# VERBOSE=1                    — print resolved paths + hook verbose output.
pretty-index-reproduce-downloaded:
	@if [ "$(VERBOSE)" = "1" ]; then \
	  echo "── pretty-index-reproduce-downloaded [verbose] ──"; \
	  echo "  INDEX (diagnostics path) : $(INDEX)"; \
	  echo "  diagnostics directory    : $(dir $(INDEX))"; \
	  echo "  PI_SCOPE                 : $(PI_SCOPE)"; \
	  echo "  mismatch report (if any) : $(PI_MISMATCH_REPORT)"; \
	  echo ""; \
	fi
	@echo "==> [1/2] verifying downloaded pretty-index checksums (scope=$(PI_SCOPE))"
	@$(MAKE) --no-print-directory pretty-index-artifacts-verify PI_SCOPE=$(PI_SCOPE)
	@echo ""
	@echo "==> [2/2] running pre-commit hook (validation mode) scope=$(PI_SCOPE)"
	@if [ "$(VERBOSE)" = "1" ]; then \
	  PRETTY_INDEX_HOOK_VERBOSE=1 \
	    $(MAKE) --no-print-directory pretty-index-hook-validate-downloaded PI_SCOPE=$(PI_SCOPE); \
	else \
	  $(MAKE) --no-print-directory pretty-index-hook-validate-downloaded PI_SCOPE=$(PI_SCOPE); \
	fi

# Cold-start reproduction: download, verify, run the hook. Requires RUN_ID.
#   make pretty-index-artifacts-download-verify-reproduce RUN_ID=<id> \
#       [OS=ubuntu-latest] [PI_SCOPE=atomic|stress|both] [VERBOSE=1]
pretty-index-artifacts-download-verify-reproduce:
	@if [ -z "$(RUN_ID)" ]; then \
	  echo "usage: make pretty-index-artifacts-download-verify-reproduce RUN_ID=<run-id> [OS=ubuntu-latest] [PI_SCOPE=atomic|stress|both] [VERBOSE=1]" >&2; \
	  exit 2; \
	fi
	@echo "==> [1/3] downloading artifacts (RUN_ID=$(RUN_ID), OS=$(OS), scope=$(PI_SCOPE))"
	@$(MAKE) --no-print-directory pretty-index-artifacts-download RUN_ID=$(RUN_ID) OS=$(OS)
	@echo ""
	@echo "==> [2/3] + [3/3] verify + reproduce (scope=$(PI_SCOPE))"
	@$(MAKE) --no-print-directory pretty-index-reproduce-downloaded PI_SCOPE=$(PI_SCOPE) VERBOSE=$(VERBOSE)


# Remove the downloaded per-matrix pretty-index diagnostic directories
# to keep local repro environments tidy. Only touches ./_pretty-index-*
# — never the real diagnostics under $(dir $(INDEX)).
pretty-index-artifacts-clean:
	@rm -rf -- ./_pretty-index-atomic ./_pretty-index-stress
	@echo "removed: ./_pretty-index-atomic ./_pretty-index-stress"




# Verify sha256 checksums for the downloaded atomic AND stress artifacts
# WITHOUT invoking the validation hook. Prints every file's expected +
# actual hash (not just mismatches) and a per-matrix + overall pass/fail
# summary at the end. Exits 0 iff both matrices verify.
pretty-index-artifacts-verify-summary:
	@case "$(PI_SCOPE)" in atomic) list="atomic";; stress) list="stress";; \
	  both) list="atomic stress";; \
	  *) echo "PI_SCOPE must be atomic|stress|both (got: $(PI_SCOPE))" >&2; exit 2;; esac; \
	overall=0; \
	atomic_status="skipped"; stress_status="skipped"; \
	for matrix in $$list; do \
	  dir="./_pretty-index-$$matrix"; \
	  echo ""; echo "── MATRIX=$$matrix ── ($$dir)"; \
	  if [ ! -d "$$dir" ]; then \
	    echo "  [FAIL] directory missing — run: make pretty-index-artifacts-download RUN_ID=<id>"; \
	    eval "$${matrix}_status=FAIL"; overall=1; continue; \
	  fi; \
	  cks="$$dir/pretty-index.checksums.sha256"; \
	  if [ ! -f "$$cks" ]; then \
	    echo "  [FAIL] pretty-index.checksums.sha256 missing"; \
	    eval "$${matrix}_status=FAIL"; overall=1; continue; \
	  fi; \
	  mstatus="PASS"; \
	  while read -r exp fname; do \
	    [ -z "$$exp" ] && continue; \
	    act=$$( ( cd "$$dir" && sha256sum "$$fname" 2>/dev/null ) | awk '{print $$1}'); \
	    if [ -z "$$act" ]; then act="<missing>"; fi; \
	    if [ "$$exp" = "$$act" ]; then s="OK"; else s="MISMATCH"; mstatus="FAIL"; overall=1; fi; \
	    echo "  $$fname  expected=$$exp  actual=$$act  [$$s]"; \
	  done < "$$cks"; \
	  eval "$${matrix}_status=$$mstatus"; \
	  echo "  → $$matrix: $$mstatus"; \
	done; \
	echo ""; \
	echo "── summary (scope=$(PI_SCOPE)) ──"; \
	echo "  atomic : $$atomic_status"; \
	echo "  stress : $$stress_status"; \
	if [ $$overall -eq 0 ]; then echo "  overall: PASS"; else echo "  overall: FAIL"; fi; \
	exit $$overall

# ── pretty-index help ────────────────────────────────────────────────
# Concise usage for every pretty-index-* target, including VERBOSE=1
# semantics per target and documented exit codes.
.PHONY: pretty-index-help
pretty-index-help:
	@echo "pretty-index-* make targets — quick reference"
	@echo ""
	@echo "Local reproduce (uses your working-tree pretty-index.json):"
	@echo "  pretty-index-check                         Run CI check flow (bash)"
	@echo "  pretty-index-check-clean                   Same, discard prior diagnostics"
	@echo "  pretty-index-check-pwsh                    Same, via PowerShell"
	@echo "  pretty-index-diagnostics                   Print diagnostic paths / artifact names"
	@echo "  pretty-index-clean                         Remove sibling .pre-check.json / .report.json"
	@echo "  pretty-index-clean-dry-run                 Preview what -clean would delete"
	@echo "  pretty-index-artifacts                     Print expected artifact filenames per matrix"
	@echo "  pretty-index-hook-dry-run                  Run pre-commit hook in dry-run for both matrices"
	@echo ""
	@echo "Download + verify + reproduce (uses ./_pretty-index-<matrix>/):"
	@echo "  pretty-index-artifacts-download            Download atomic + stress from a CI run"
	@echo "                                             (needs RUN_ID=<id>, OS=ubuntu-latest by default)"
	@echo "  pretty-index-artifacts-verify              sha256sum -c both dirs; writes JSON mismatch"
	@echo "                                             report to \$$(PI_MISMATCH_REPORT) on failure"
	@echo "  pretty-index-artifacts-verify-summary      Verify + pretty per-matrix PASS/FAIL summary"
	@echo "                                             with per-file expected/actual hashes"
	@echo "  pretty-index-hook-validate-downloaded      Verify, then run the hook in validation mode"
	@echo "  pretty-index-reproduce-downloaded          One-command verify + validate"
	@echo "  pretty-index-artifacts-download-verify-reproduce"
	@echo "                                             Cold start: download + verify + validate"
	@echo "  pretty-index-artifacts-clean               rm -rf ./_pretty-index-atomic ./_pretty-index-stress"
	@echo ""
	@echo "Scope / overrides:"
	@echo "  PI_SCOPE=atomic|stress|both   (default: both)   restrict download-flow targets"
	@echo "  MATRIX=atomic|stress          (default: atomic) single-run local-repro matrix"
	@echo "  INDEX=<path>                                    override pretty-index.json path"
	@echo "  RUN_ID=<id> OS=<runner>                         for -artifacts-download*"
	@echo "  PI_MISMATCH_REPORT=<path>                       where -verify writes its JSON on fail"
	@echo ""
	@echo "VERBOSE=1 effects (per target):"
	@echo "  pretty-index-reproduce-downloaded          Prints resolved INDEX, diagnostics dir,"
	@echo "                                             PI_SCOPE, mismatch-report path; forwards"
	@echo "                                             PRETTY_INDEX_HOOK_VERBOSE=1 to the hook so"
	@echo "                                             each step lists [exists]/[absent] files."
	@echo "  pretty-index-artifacts-download-verify-reproduce"
	@echo "                                             Forwards VERBOSE=1 to -reproduce-downloaded."
	@echo "  (other targets ignore VERBOSE.)"
	@echo ""
	@echo "Exit codes (make normalizes any recipe failure to 2 at the outer layer):"
	@echo "  0  success (verify passed / hook passed / dry-run)"
	@echo "  1  a downstream check failed (checksum mismatch OR hook validation failed)"
	@echo "  2  usage error, missing directory, missing checksums file, or missing RUN_ID"
	@echo "  Underlying pre-commit hook: 0=ok  1=drift  2=usage  3=schema  4=missing input"
	@echo "  Run '.githooks/pre-commit --help' for the hook's full exit-code table."



# ── Post-verify inspection helpers ───────────────────────────────────
# All three read the JSON report written by pretty-index-artifacts-verify
# (path: $(PI_REPORT_PATH)). Require jq.
.PHONY: pretty-index-mismatch-show pretty-index-mismatch-merge \
        pretty-index-mismatch-validate pretty-index-mismatch-summary \
        pretty-index-mismatch-summary-json \
        pretty-index-mismatch-summary-json-merge \
        pretty-index-mismatch-summary-validate \
        pretty-index-mismatch-summary-md \
        pretty-index-mismatch-csv pretty-index-mismatch-diff \
         pretty-index-mismatch-ci pretty-index-validate-report-check \
         pretty-index-ci-tarball-verify \
         pretty-index-mismatch-ci-bundle-download \
         pretty-index-mismatch-ci-bundle-recheck \
         pretty-index-mismatch-ci-bundle-clean


# Standalone strict schema check for an arbitrary validate-report.json —
# same jq assertion invoked by `pretty-index-mismatch-ci`. Usable in
# pre-commit hooks or ad-hoc CI wiring:
#   make pretty-index-validate-report-check VALIDATE_REPORT_JSON=path/to/file.json
# Exits: 0 ok, 2 tooling/missing file, 5 schema assertion failed.
pretty-index-validate-report-check:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@rj="$(VALIDATE_REPORT_JSON)"; \
	 if [ -z "$$rj" ]; then \
	   echo "usage: make pretty-index-validate-report-check VALIDATE_REPORT_JSON=<path>" >&2; exit 2; \
	 fi; \
	 if [ ! -s "$$rj" ]; then \
	   echo "ERROR: validate-report.json not present or empty (path=$$rj)" >&2; exit 2; \
	 fi; \
	 problems=$$(jq -r ' \
	   . as $$r | \
	   { schema:"string", status:"string", exit_code:"number", file:"string", \
	     summary_schema:"string", note:"string", errors:"array" } as $$want | \
	   [ $$want | to_entries[] | .key as $$k | .value as $$t | \
	     if ($$r | has($$k) | not) then "  - \($$k): missing (detected: null, expected \($$t))" \
	     elif (($$r[$$k] | type) != $$t) then "  - \($$k): wrong type (detected: \($$r[$$k] | type), expected \($$t))" \
	     else empty end ] | .[]' -- "$$rj" 2>/dev/null); \
	 if [ -n "$$problems" ]; then \
	   echo "ERROR: validate-report.json failed schema assertion (path=$$rj):" >&2; \
	   echo "$$problems" >&2; \
	   echo "  expected keys: schema(string) status(string) exit_code(number) file(string) summary_schema(string) note(string) errors(array)" >&2; \
	   exit 5; \
	 fi; \
	 echo "OK: $$rj matches pretty-index-mismatch-summary-validate/v1 shape"

# Verify a produced PI_CI tarball contains the required debugging files at
# the expected paths, then run the strict schema check on the extracted
# validate-report.json. Usable in CI after `pretty-index-mismatch-ci` to
# guarantee the uploaded artifact is triage-ready:
#   make pretty-index-ci-tarball-verify PI_CI_TARBALL=/tmp/pi-ci-atomic.tar.gz
# Optional: PI_CI_TARBALL_ROOT=<name>  (default: basename of $PI_CI_OUT_DIR)
# Exits: 0 ok, 2 tooling/missing tarball/entries, 5 schema assertion failed.
PI_CI_TARBALL_ROOT ?= $(notdir $(PI_CI_OUT_DIR))
pretty-index-ci-tarball-verify:
	@command -v jq  >/dev/null || { echo "jq required"  >&2; exit 2; }
	@command -v tar >/dev/null || { echo "tar required" >&2; exit 2; }
	@tb="$(PI_CI_TARBALL)"; \
	 if [ -z "$$tb" ] || [ ! -s "$$tb" ]; then \
	   echo "usage: make pretty-index-ci-tarball-verify PI_CI_TARBALL=<file.tgz> [PI_CI_TARBALL_ROOT=<dir>]" >&2; \
	   echo "ERROR: tarball not present or empty (path=$$tb)" >&2; exit 2; \
	 fi; \
	 root="$(PI_CI_TARBALL_ROOT)"; \
	 want1="$$root/validate-report.json"; \
	 want2="$$root/validate-schema-assertion.txt"; \
	 listing=$$(tar -tzf "$$tb"); \
	 miss=""; \
	 for w in "$$want1" "$$want2"; do \
	   printf '%s\n' "$$listing" | grep -Fxq -- "$$w" || miss="$$miss $$w"; \
	 done; \
	 if [ -n "$$miss" ]; then \
	   echo "ERROR: tarball $$tb missing expected entries:" >&2; \
	   for m in $$miss; do echo "  - $$m" >&2; done; \
	   echo "  tarball contents:" >&2; printf '%s\n' "$$listing" | sed 's/^/    /' >&2; \
	   exit 2; \
	 fi; \
	 td=$$(mktemp -d); trap 'rm -rf -- "$$td"' EXIT; \
	 tar -xzf "$$tb" -C "$$td" -- "$$want1" "$$want2"; \
	 echo "OK: tarball contains $$want1 and $$want2"; \
	 $(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory \
	   pretty-index-validate-report-check \
	   VALIDATE_REPORT_JSON="$$td/$$want1"


# Download the uploaded pretty-index-mismatch-ci bundle tarball from a
# GitHub Actions run and extract it locally, so you can inspect
# `validate-report.json` + `validate-schema-assertion.txt` without
# clicking around the Actions UI. Requires the `gh` CLI (authenticated).
#
# Usage:
#   make pretty-index-mismatch-ci-bundle-download RUN_ID=<run-id> \
#     [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]
#
# Output layout:
#   ./_pi-ci-bundle-<scope>/<tarball>.tar.gz         (the uploaded tarball)
#   ./_pi-ci-bundle-<scope>/extracted/...            (extracted contents,
#     including <root>/validate-report.json + <root>/validate-schema-assertion.txt)
PI_CI_SCOPE ?= atomic
OS          ?= ubuntu-latest
pretty-index-mismatch-ci-bundle-download:
	@command -v gh  >/dev/null || { echo "gh CLI required (https://cli.github.com)" >&2; exit 2; }
	@command -v tar >/dev/null || { echo "tar required" >&2; exit 2; }
	@if [ -z "$(RUN_ID)" ]; then \
	   echo "usage: make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> [PI_CI_SCOPE=atomic|stress] [OS=ubuntu-latest]" >&2; \
	   exit 2; \
	 fi
	@case "$(PI_CI_SCOPE)" in atomic|stress) ;; *) \
	   echo "ERROR: PI_CI_SCOPE must be 'atomic' or 'stress' (got '$(PI_CI_SCOPE)')" >&2; exit 2;; esac
	@name="pretty-index-mismatch-ci-bundle-$(PI_CI_SCOPE)-$(OS)"; \
	 out="./_pi-ci-bundle-$(PI_CI_SCOPE)"; \
	 rm -rf -- "$$out"; mkdir -p -- "$$out/extracted"; \
	 echo "==> downloading artifact $$name (run $(RUN_ID))"; \
	 gh run download "$(RUN_ID)" -n "$$name" -D "$$out"; \
	 tb=$$(ls -1 "$$out"/*.tar.gz 2>/dev/null | head -n1); \
	 if [ -z "$$tb" ] || [ ! -s "$$tb" ]; then \
	   echo "ERROR: no *.tar.gz found in $$out after download" >&2; \
	   ls -la "$$out" >&2 || true; exit 2; \
	 fi; \
	 echo "==> extracting $$tb -> $$out/extracted"; \
	 tar -xzf "$$tb" -C "$$out/extracted"; \
	 root=$$(tar -tzf "$$tb" | head -n1 | cut -d/ -f1); \
	 vr="$$out/extracted/$$root/validate-report.json"; \
	 va="$$out/extracted/$$root/validate-schema-assertion.txt"; \
	 miss=""; \
	 [ -f "$$vr" ]  || miss="$$miss $$root/validate-report.json(missing)"; \
	 [ -f "$$va" ]  || miss="$$miss $$root/validate-schema-assertion.txt(missing)"; \
	 [ -f "$$va" ] && [ ! -s "$$va" ] && \
	   miss="$$miss $$root/validate-schema-assertion.txt(empty)"; \
	 if [ -n "$$miss" ]; then \
	   echo "ERROR: extracted tarball $$tb failed content checks:" >&2; \
	   for m in $$miss; do \
	     case "$$m" in \
	       *"(missing)") p=$${m%\(missing\)}; \
	         echo "  - MISSING file: expected at $$out/extracted/$$p" >&2 ;; \
	       *"(empty)")   p=$${m%\(empty\)};   \
	         echo "  - EMPTY   file: expected non-empty at $$out/extracted/$$p" >&2 ;; \
	     esac; \
	   done; \
	   echo "  extracted tree:" >&2; \
	   (cd "$$out/extracted" && find . -maxdepth 3 -type f | sed 's/^/    /') >&2; \
	   exit 2; \
	 fi; \
	 echo ""; \
	 echo "artifact          : $$name"; \
	 echo "tarball           : $$tb"; \
	 echo "validate-report   : $$vr (present)"; \
	 echo "schema-assertion  : $$va (present, $$(wc -c < "$$va") bytes)"; \
	 echo ""; \
	 echo "inspect with:"; \
	 echo "  jq . '$$vr'"; \
	 echo "  cat '$$va'"; \
	 echo "  make pretty-index-ci-tarball-verify PI_CI_TARBALL='$$tb' PI_CI_TARBALL_ROOT='$$root'"; \
	 echo "  make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE='$(PI_CI_SCOPE)'"


# Re-run the strict schema check against the ALREADY-EXTRACTED
# validate-report.json from `pretty-index-mismatch-ci-bundle-download`.
# Cheap local loop for iterating on validator failures without hitting
# the `gh` CLI / network again.
#   make pretty-index-mismatch-ci-bundle-recheck                  # defaults: PI_CI_SCOPE=atomic
#   make pretty-index-mismatch-ci-bundle-recheck PI_CI_SCOPE=stress
pretty-index-mismatch-ci-bundle-recheck:
	@case "$(PI_CI_SCOPE)" in atomic|stress) ;; *) \
	   echo "ERROR: PI_CI_SCOPE must be 'atomic' or 'stress' (got '$(PI_CI_SCOPE)')" >&2; exit 2;; esac
	@out="./_pi-ci-bundle-$(PI_CI_SCOPE)/extracted"; \
	 if [ ! -d "$$out" ]; then \
	   echo "ERROR: no extracted bundle at $$out" >&2; \
	   echo "  run: make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=$(PI_CI_SCOPE)" >&2; \
	   exit 2; \
	 fi; \
	 vr=$$(find "$$out" -maxdepth 3 -type f -name validate-report.json | head -n1); \
	 if [ -z "$$vr" ] || [ ! -s "$$vr" ]; then \
	   echo "ERROR: validate-report.json not found (or empty) under $$out" >&2; exit 2; \
	 fi; \
	 echo "==> re-checking $$vr"; \
	 $(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory \
	   pretty-index-validate-report-check VALIDATE_REPORT_JSON="$$vr"


# Remove the locally-extracted bundle directory so
# `pretty-index-mismatch-ci-bundle-recheck` (or a fresh
# `…-bundle-download`) starts from a clean slate. No-op when the
# directory doesn't exist.
#   make pretty-index-mismatch-ci-bundle-clean                # PI_CI_SCOPE=atomic
#   make pretty-index-mismatch-ci-bundle-clean PI_CI_SCOPE=stress
pretty-index-mismatch-ci-bundle-clean:
	@case "$(PI_CI_SCOPE)" in atomic|stress) ;; *) \
	   echo "ERROR: PI_CI_SCOPE must be 'atomic' or 'stress' (got '$(PI_CI_SCOPE)')" >&2; exit 2;; esac
	@out="./_pi-ci-bundle-$(PI_CI_SCOPE)"; \
	 if [ -e "$$out" ]; then \
	   rm -rf -- "$$out"; echo "removed $$out"; \
	 else \
	   echo "nothing to clean (no such dir: $$out)"; \
	 fi




# Print a human-friendly per-file table (file, expected, actual, status)
# from the mismatch report. Use PI_REPORT_PATH=<path> to point elsewhere.
# Optional PI_PATH_GLOB=<glob> filters rows by .path (e.g. "*.report.json").
pretty-index-mismatch-show:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ ! -f "$(PI_REPORT_PATH)" ]; then \
	  echo "no mismatch report at $(PI_REPORT_PATH) — verify probably passed" >&2; exit 2; \
	fi
	@echo "── pretty-index mismatch report: $(PI_REPORT_PATH) ──"
	@jq -r '"scope=\(.scope)  fail_fast=\(.fail_fast // false)"' -- "$(PI_REPORT_PATH)"
	@if [ -n "$(PI_PATH_GLOB)" ]; then echo "filter: PI_PATH_GLOB=$(PI_PATH_GLOB)"; fi
	@echo ""
	@printf "%-22s  %-42s  %-9s  %-64s  %s\n" ARTIFACT_DIR FILE STATUS EXPECTED ACTUAL
	@glob='$(PI_PATH_GLOB)'; \
	 re=$$(printf '%s' "$$glob" | sed -e 's/[.[\^$$+(){}|]/\\&/g' -e 's/\*/.*/g' -e 's/?/./g'); \
	 jq -r --arg re "$$re" '.results[] | select(($$re == "") or ((.path // .file // "") | test($$re))) | [ (.artifact_dir // "-"), (.file // "-"), .status, (.expected // "-"), (.actual // "-") ] | @tsv' \
	  -- "$(PI_REPORT_PATH)" \
	| awk -F'\t' '{printf "%-22s  %-42s  %-9s  %-64s  %s\n", $$1, $$2, $$3, $$4, $$5}'
	@echo ""
	@n_mm=$$(jq '[.results[] | select(.status=="MISMATCH")] | length' -- "$(PI_REPORT_PATH)"); \
	 n_err=$$(jq '[.results[] | select(.status=="dir_missing" or .status=="checksums_missing")] | length' -- "$(PI_REPORT_PATH)"); \
	 echo "summary: $$n_mm mismatched file(s), $$n_err missing-artifact error(s)"

# Print counts of mismatches per matrix (atomic vs stress) with mismatched
# vs total files. Exits 3 when any mismatch or missing-artifact error is
# present, 0 when the report is clean.
pretty-index-mismatch-summary:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ ! -f "$(PI_REPORT_PATH)" ]; then \
	  echo "no mismatch report at $(PI_REPORT_PATH) — verify probably passed" >&2; exit 2; \
	fi
	@echo "── mismatch summary: $(PI_REPORT_PATH) ──"
	@for mx in atomic stress; do \
	  total=$$(jq --arg m "$$mx" '[.results[] | select((.matrix // "") == $$m or ((.artifact_dir // "") | test($$m)))] | length' -- "$(PI_REPORT_PATH)"); \
	  mm=$$(jq --arg m "$$mx" '[.results[] | select(((.matrix // "") == $$m or ((.artifact_dir // "") | test($$m))) and .status=="MISMATCH")] | length' -- "$(PI_REPORT_PATH)"); \
	  err=$$(jq --arg m "$$mx" '[.results[] | select(((.matrix // "") == $$m or ((.artifact_dir // "") | test($$m))) and (.status=="dir_missing" or .status=="checksums_missing"))] | length' -- "$(PI_REPORT_PATH)"); \
	  echo "  $$mx: $$mm/$$total mismatched  ($$err missing-artifact err)"; \
	done
	@total_mm=$$(jq '[.results[] | select(.status=="MISMATCH")] | length' -- "$(PI_REPORT_PATH)"); \
	 total_err=$$(jq '[.results[] | select(.status=="dir_missing" or .status=="checksums_missing")] | length' -- "$(PI_REPORT_PATH)"); \
	 total_all=$$(jq '.results | length' -- "$(PI_REPORT_PATH)"); \
	 echo "  total: $$total_mm/$$total_all mismatched  ($$total_err missing-artifact err)"; \
	 if [ "$$total_mm" -gt 0 ] || [ "$$total_err" -gt 0 ]; then exit 3; fi

# Machine-readable variant of pretty-index-mismatch-summary — writes a
# small JSON file with per-matrix counts and totals for easy CI parsing.
# Output shape:
#   {"schema":"pretty-index-mismatch-summary/v1",
#    "scope":"both",
#    "matrices":{"atomic":{"total":N,"mismatched":N,"missing":N},
#                "stress":{"total":N,"mismatched":N,"missing":N}},
#    "totals":{"total":N,"mismatched":N,"missing":N}}
# Exit 0 always (writing succeeded); the JSON's totals.mismatched field
# is what CI should assert on.
#   PI_REPORT_PATH=<in>  PI_SUMMARY_JSON_PATH=<out>  (default: <report>.summary.json)
PI_SUMMARY_JSON_PATH ?= $(PI_REPORT_PATH).summary.json
pretty-index-mismatch-summary-json:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ ! -f "$(PI_REPORT_PATH)" ]; then \
	  echo "no mismatch report at $(PI_REPORT_PATH)" >&2; exit 2; \
	fi
	@mkdir -p -- "$$(dirname -- "$(PI_SUMMARY_JSON_PATH)")" 2>/dev/null || true
	@jq '. as $$root | (.results // []) as $$r | def cnt(m): {total: ([$$r[] | select((.matrix // "") == m or ((.artifact_dir // "") | test(m)))] | length), mismatched: ([$$r[] | select(((.matrix // "") == m or ((.artifact_dir // "") | test(m))) and .status=="MISMATCH")] | length), missing: ([$$r[] | select(((.matrix // "") == m or ((.artifact_dir // "") | test(m))) and (.status=="dir_missing" or .status=="checksums_missing"))] | length)}; {schema:"pretty-index-mismatch-summary/v1", scope:($$root.scope // "both"), matrices:{atomic: cnt("atomic"), stress: cnt("stress")}, totals:{total: ($$r | length), mismatched: ([$$r[] | select(.status=="MISMATCH")] | length), missing: ([$$r[] | select(.status=="dir_missing" or .status=="checksums_missing")] | length)}}' -- "$(PI_REPORT_PATH)" > "$(PI_SUMMARY_JSON_PATH)"
	@echo "wrote summary -> $(PI_SUMMARY_JSON_PATH)"

# Merge multiple pretty-index-mismatch-summary-json outputs (e.g. one per
# matrix job in CI) into a single consolidated JSON. Sums per-matrix and
# per-totals counters element-wise and records the source file list.
# Output shape:
#   {"schema":"pretty-index-mismatch-summary-merged/v1",
#    "merged_from":[...],
#    "sources":[{"path":..., "scope":..., "totals":{...}}, ...],
#    "matrices":{"atomic":{"total":N,"mismatched":N,"missing":N},
#                "stress":{"total":N,"mismatched":N,"missing":N}},
#    "totals":{"total":N,"mismatched":N,"missing":N}}
#   PI_SUMMARY_INPUTS='<glob or space-separated list>'   e.g. "/tmp/*.summary.json"
#   PI_SUMMARY_MERGED_PATH=<out>                          default: pretty-index-mismatch-summary.merged.json
PI_SUMMARY_MERGED_PATH ?= pretty-index-mismatch-summary.merged.json
pretty-index-mismatch-summary-json-merge:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ -z "$(PI_SUMMARY_INPUTS)" ]; then \
	  echo "usage: make pretty-index-mismatch-summary-json-merge PI_SUMMARY_INPUTS='f1.json f2.json' [PI_SUMMARY_MERGED_PATH=out.json]" >&2; exit 2; \
	fi
	@files=""; missing_json="["; names_json="["; sep_n=""; sep_m=""; \
	for f in $(PI_SUMMARY_INPUTS); do \
	  esc=$$(printf '%s' "$$f" | sed 's/\\/\\\\/g; s/"/\\"/g'); \
	  names_json="$$names_json$$sep_n\"$$esc\""; sep_n=","; \
	  if [ -f "$$f" ]; then \
	    files="$$files $$f"; \
	  else \
	    echo "warn: missing input (treated as zero counts): $$f" >&2; \
	    missing_json="$$missing_json$$sep_m\"$$esc\""; sep_m=","; \
	  fi; \
	done; \
	names_json="$$names_json]"; missing_json="$$missing_json]"; \
	mkdir -p -- "$$(dirname -- "$(PI_SUMMARY_MERGED_PATH)")" 2>/dev/null || true; \
	if [ -z "$$files" ]; then \
	  jq -n --argjson names "$$names_json" --argjson missing "$$missing_json" \
	    'def zero: {total:0,mismatched:0,missing:0}; {schema:"pretty-index-mismatch-summary-merged/v1", merged_from:$$names, sources:[$$missing[] | {path:., scope:"unknown", missing:true, totals:zero}], matrices:{atomic:zero, stress:zero}, totals:zero}' \
	    > "$(PI_SUMMARY_MERGED_PATH)"; \
	else \
	  jq -s --argjson names "$$names_json" --argjson missing "$$missing_json" \
	    'def zero: {total:0,mismatched:0,missing:0}; def add(a;b): {total:((a.total//0)+(b.total//0)), mismatched:((a.mismatched//0)+(b.mismatched//0)), missing:((a.missing//0)+(b.missing//0))}; . as $$in | ($$in | length) as $$n | {schema:"pretty-index-mismatch-summary-merged/v1", merged_from:$$names, sources: ([range(0; $$n) as $$i | {path:($$names[$$i]), scope:($$in[$$i].scope // "unknown"), missing:false, totals:($$in[$$i].totals // zero)}] + [$$missing[] | {path:., scope:"unknown", missing:true, totals:zero}]), matrices:{atomic: (reduce .[] as $$s (zero; add(.; ($$s.matrices.atomic // zero)))), stress: (reduce .[] as $$s (zero; add(.; ($$s.matrices.stress // zero))))}, totals: (reduce .[] as $$s (zero; add(.; ($$s.totals // zero))))}' \
	    -- $$files > "$(PI_SUMMARY_MERGED_PATH)"; \
	fi
	@echo "merged $(words $(PI_SUMMARY_INPUTS)) input(s) -> $(PI_SUMMARY_MERGED_PATH)"
	@jq -r '"  matrices.atomic.mismatched=\(.matrices.atomic.mismatched)  matrices.stress.mismatched=\(.matrices.stress.mismatched)  totals.mismatched=\(.totals.mismatched)/\(.totals.total)"' -- "$(PI_SUMMARY_MERGED_PATH)"

# Validate a pretty-index-mismatch-summary-json (or merged) file against
# schemas/pretty-index-mismatch-summary-json.schema.json. Uses ajv when
# available; otherwise falls back to a jq-based structural check on the
# required fields (schema, matrices.{atomic,stress}.{total,mismatched,missing},
# totals.{total,mismatched,missing}). Exit 2 on missing file / tooling,
# exit 5 on validation failure, exit 0 on success.
#   PI_SUMMARY_JSON_PATH=<file>  (defaults to $(PI_REPORT_PATH).summary.json)
pretty-index-mismatch-summary-validate:
	@f="$(PI_SUMMARY_JSON_PATH)"; rj="$(PI_VALIDATE_REPORT_JSON)"; \
	 write_report() { \
	   status="$$1"; code="$$2"; errs_text="$$3"; schema_val="$$4"; note="$$5"; \
	   [ -n "$$rj" ] || return 0; \
	   mkdir -p -- "$$(dirname -- "$$rj")" 2>/dev/null || true; \
	   printf '%s\n' "$$errs_text" | jq -R -s --arg status "$$status" --arg file "$$f" \
	     --argjson code "$$code" --arg schema "$$schema_val" --arg note "$$note" \
	     '{schema:"pretty-index-mismatch-summary-validate/v1", status:$$status, exit_code:$$code, file:$$file, summary_schema:$$schema, note:$$note, errors: ((. | split("\n")) | map(select(length>0)))}' \
	     > "$$rj" 2>/dev/null || true; \
	 }; \
	 gha_err() { if [ "$${GITHUB_ACTIONS:-}" = "true" ]; then while IFS= read -r line; do [ -n "$$line" ] && printf '::error file=%s::%s\n' "$$f" "$$line" >&2; done; fi; }; \
	 if [ ! -f "$$f" ]; then echo "ERROR: no summary at path='$$f'" >&2; printf '%s\n' "no summary at path='$$f'" | gha_err; write_report "missing" 2 "no summary at path='$$f'" "" ""; exit 2; fi; \
	 schema=schemas/pretty-index-mismatch-summary-json.schema.json; \
	 if [ ! -f "$$schema" ]; then echo "ERROR: missing schema at path='$$schema'" >&2; write_report "tooling" 2 "missing schema at path='$$schema'" "" ""; exit 2; fi; \
	 command -v jq >/dev/null 2>&1 && sv=$$(jq -r '.schema // ""' -- "$$f" 2>/dev/null) || sv=""; \
	 case "$$sv" in \
	   pretty-index-mismatch-summary/v0) \
	     msg="DEPRECATED: schema 'pretty-index-mismatch-summary/v0' is accepted for backward compatibility; regenerate with the current tool to produce 'pretty-index-mismatch-summary/v1'"; \
	     echo "warn: $$msg" >&2; \
	     if [ "$${GITHUB_ACTIONS:-}" = "true" ]; then printf '::warning file=%s::%s\n' "$$f" "$$msg" >&2; fi; \
	     write_report "deprecated" 0 "" "$$sv" "$$msg"; \
	     echo "OK (deprecated v0) $$f"; exit 0;; \
	 esac; \
	 if command -v npx >/dev/null 2>&1 && npx --no-install ajv --help >/dev/null 2>&1; then \
	   ajv_out=$$(npx --no-install ajv validate -s "$$schema" -d "$$f" --strict=false --errors=text 2>&1) || { \
	     echo "$$ajv_out" >&2; \
	     printf '%s\n' "$$ajv_out" | gha_err; \
	     write_report "invalid" 5 "$$ajv_out" "$$sv" "ajv validation failed"; \
	     echo "ERROR: ajv validation failed for '$$f'" >&2; exit 5; }; \
	 else \
	   command -v jq >/dev/null || { echo "ERROR: jq required (ajv not found)" >&2; write_report "tooling" 2 "jq required (ajv not found)" "" ""; exit 2; }; \
	   if ! jq -e . -- "$$f" >/dev/null 2>&1; then \
	     echo "ERROR: '$$f' is not valid JSON" >&2; \
	     printf '%s\n' "'$$f' is not valid JSON" | gha_err; \
	     write_report "invalid" 5 "'$$f' is not valid JSON" "$$sv" "parse error"; \
	     exit 5; \
	   fi; \
	   errs=$$(jq -r '\
	     def isnn(x): (x|type)=="number" and (x|floor)==x and x>=0; \
	     def chk(path; ok; val): if ok then empty else "  - path=\(path)  problem=invalid_or_missing  value=\(val|tostring)" end; \
	     def cntErrs(p; c): \
	       chk("\(p).total";      (c|type)=="object" and isnn(c.total);      (c.total // "<missing>")), \
	       chk("\(p).mismatched"; (c|type)=="object" and isnn(c.mismatched); (c.mismatched // "<missing>")), \
	       chk("\(p).missing";    (c|type)=="object" and isnn(c.missing);    (c.missing // "<missing>")); \
	     [ chk(".schema"; (.schema=="pretty-index-mismatch-summary/v1" or .schema=="pretty-index-mismatch-summary-merged/v1" or .schema=="pretty-index-mismatch-summary/v0"); (.schema // "<missing>")), \
	       chk(".matrices"; (.matrices|type)=="object"; (.matrices // "<missing>")), \
	       cntErrs(".matrices.atomic"; (.matrices.atomic // {})), \
	       cntErrs(".matrices.stress"; (.matrices.stress // {})), \
	       cntErrs(".totals";          (.totals // {})) \
	     ] | map(select(. != null)) | .[]' -- "$$f"); \
	   if [ -n "$$errs" ]; then \
	     echo "ERROR: invalid summary '$$f':" >&2; \
	     echo "$$errs" >&2; \
	     printf '%s\n' "$$errs" | gha_err; \
	     write_report "invalid" 5 "$$errs" "$$sv" "shape validation failed"; \
	     exit 5; \
	   fi; \
	 fi; \
	 write_report "ok" 0 "" "$$sv" ""; \
	 echo "OK $$f"

# Render a small human-readable markdown report from a summary JSON
# (single or merged). Writes to $(PI_SUMMARY_MD_PATH) which defaults to
# alongside the summary file with a `.md` suffix.
#   PI_SUMMARY_JSON_PATH=<in>   PI_SUMMARY_MD_PATH=<out>
PI_SUMMARY_MD_PATH ?= $(PI_SUMMARY_JSON_PATH).md
pretty-index-mismatch-summary-md:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@f="$(PI_SUMMARY_JSON_PATH)"; \
	 if [ ! -f "$$f" ]; then echo "no summary at $$f" >&2; exit 2; fi; \
	 mkdir -p -- "$$(dirname -- "$(PI_SUMMARY_MD_PATH)")" 2>/dev/null || true; \
	 { \
	   echo "# pretty-index mismatch summary"; \
	   echo ""; \
	   echo "- source: \`$$f\`"; \
	   echo "- schema: \`$$(jq -r '.schema // "unknown"' -- "$$f")\`"; \
	   scope=$$(jq -r '.scope // empty' -- "$$f"); \
	   if [ -n "$$scope" ]; then echo "- scope: \`$$scope\`"; fi; \
	   echo ""; \
	   echo "| matrix | total | mismatched | missing |"; \
	   echo "| --- | ---: | ---: | ---: |"; \
	   jq -r '.matrices | to_entries[] | "| \(.key) | \(.value.total) | \(.value.mismatched) | \(.value.missing) |"' -- "$$f"; \
	   jq -r '.totals   | "| **total** | \(.total) | \(.mismatched) | \(.missing) |"' -- "$$f"; \
	   srcs=$$(jq -r '(.merged_from // []) | length' -- "$$f"); \
	   if [ "$$srcs" -gt 0 ]; then \
	     echo ""; \
	     echo "## merged sources"; \
	     echo ""; \
	     echo "| path | scope | missing | total | mismatched | missing_files |"; \
	     echo "| --- | --- | :---: | ---: | ---: | ---: |"; \
	     jq -r '.sources[]? | "| \(.path) | \(.scope // "-") | \(.missing // false) | \(.totals.total) | \(.totals.mismatched) | \(.totals.missing) |"' -- "$$f"; \
	   fi; \
	 } > "$(PI_SUMMARY_MD_PATH)"
	@echo "wrote $(PI_SUMMARY_MD_PATH)"



# Export the mismatch JSON report into a CSV file with columns:
# matrix, artifact_dir, path, expected_hash, actual_hash
#   PI_REPORT_PATH=<in>  PI_CSV_PATH=<out>  (default: <report>.csv)
PI_CSV_PATH ?= $(PI_REPORT_PATH).csv
pretty-index-mismatch-csv:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ ! -f "$(PI_REPORT_PATH)" ]; then \
	  echo "no mismatch report at $(PI_REPORT_PATH)" >&2; exit 2; \
	fi
	@mkdir -p -- "$$(dirname -- "$(PI_CSV_PATH)")" 2>/dev/null || true
	@{ echo "matrix,artifact_dir,path,expected_hash,actual_hash"; \
	   jq -r '.results[] | [ (.matrix // ""), (.artifact_dir // ""), (.path // .file // ""), (.expected // ""), (.actual // "") ] | @csv' \
	    -- "$(PI_REPORT_PATH)"; \
	 } > "$(PI_CSV_PATH)"
	@n=$$(($$(wc -l < "$(PI_CSV_PATH)") - 1)); echo "wrote $$n row(s) -> $(PI_CSV_PATH)"

# Compare current mismatch report against a baseline; print only NEW or
# CHANGED entries (keyed by artifact_dir + path). Exits 4 if any diffs
# are present, 0 if the two reports are equivalent.
#   PI_BASELINE=<path>  PI_REPORT_PATH=<current>
PI_BASELINE ?= _pretty-index-checksum-mismatch.baseline.json
pretty-index-mismatch-diff:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@for f in "$(PI_BASELINE)" "$(PI_REPORT_PATH)"; do \
	  [ -f "$$f" ] || { echo "missing report: $$f" >&2; exit 2; }; \
	done
	@echo "── diff: baseline=$(PI_BASELINE)  current=$(PI_REPORT_PATH) ──"
	@diff_json=$$(jq -n --slurpfile b "$(PI_BASELINE)" --slurpfile c "$(PI_REPORT_PATH)" \
	  'def key(r): (r.artifact_dir // "") + "\u0000" + (r.path // r.file // ""); \
	   def idx(rs): reduce rs[] as $$r ({}; .[key($$r)] = $$r); \
	   ((($$b[0]).results) // []) as $$br | ((($$c[0]).results) // []) as $$cr | \
	   (idx($$br)) as $$B | (idx($$cr)) as $$C | \
	   [ $$C | to_entries[] | . as $$e | ($$B[$$e.key]) as $$prev | \
	     if $$prev == null then {change:"NEW", current:$$e.value} \
	     elif ($$prev | tostring) != ($$e.value | tostring) then {change:"CHANGED", baseline:$$prev, current:$$e.value} \
	     else empty end ]'); \
	 count=$$(echo "$$diff_json" | jq 'length'); \
	 echo "$$diff_json" | jq -r '.[] | "[\(.change)] \(.current.artifact_dir // "-")/\(.current.path // .current.file // "-")  status=\(.current.status)  expected=\(.current.expected // "-")  actual=\(.current.actual // "-")"'; \
	 echo "diff entries: $$count"; \
	 if [ -n "$(PI_DIFF_OUT_PATH)" ]; then \
	   mkdir -p -- "$$(dirname -- "$(PI_DIFF_OUT_PATH)")" 2>/dev/null || true; \
	   echo "$$diff_json" | jq --arg baseline "$(PI_BASELINE)" --arg current "$(PI_REPORT_PATH)" \
	     '{schema:"pretty-index-mismatch-diff/v1", baseline:$$baseline, current:$$current, count:length, entries:.}' \
	     > "$(PI_DIFF_OUT_PATH)"; \
	   echo "wrote diff report -> $(PI_DIFF_OUT_PATH)"; \
	 fi; \
	 if [ "$$count" -gt 0 ]; then exit 4; fi

# Merge two separately-generated mismatch reports (e.g. produced by
# per-matrix CI jobs) into one file. Only meaningful for PI_SCOPE=both.
#   ATOMIC_REPORT=<path>  STRESS_REPORT=<path>  PI_REPORT_PATH=<out>
ATOMIC_REPORT ?= _pretty-index-checksum-mismatch-atomic.json
STRESS_REPORT ?= _pretty-index-checksum-mismatch-stress.json
pretty-index-mismatch-merge:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ "$(PI_SCOPE)" != "both" ]; then \
	  echo "PI_SCOPE must be 'both' to merge (got: $(PI_SCOPE))" >&2; exit 2; \
	fi
	@for f in "$(ATOMIC_REPORT)" "$(STRESS_REPORT)"; do \
	  [ -f "$$f" ] || { echo "missing input report: $$f" >&2; exit 2; }; \
	done
	@mkdir -p -- "$$(dirname -- "$(PI_REPORT_PATH)")" 2>/dev/null || true
	@jq -s '{schema:"pretty-index-checksum-mismatch/v1", scope:"both", fail_fast: ((.[0].fail_fast // false) or (.[1].fail_fast // false)), merged_from: ["$(ATOMIC_REPORT)","$(STRESS_REPORT)"], results: ((.[0].results // []) + (.[1].results // []))}' -- "$(ATOMIC_REPORT)" "$(STRESS_REPORT)" > "$(PI_REPORT_PATH)"

	@echo "merged $(ATOMIC_REPORT) + $(STRESS_REPORT) -> $(PI_REPORT_PATH)"
	@jq -r '"  scope=\(.scope)  results=\(.results | length)  merged_from=\(.merged_from | length) file(s)"' \
	  -- "$(PI_REPORT_PATH)"

# Validate an existing mismatch report against the documented v1 schema.
# Exit 0 = valid, exit 1 = malformed (prints the first failing rule).
pretty-index-mismatch-validate:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ ! -f "$(PI_REPORT_PATH)" ]; then \
	  echo "no report at $(PI_REPORT_PATH)" >&2; exit 2; \
	fi
	@err=$$(jq -r 'def bad(msg): "SCHEMA ERROR: " + msg; if type != "object" then bad("root must be an object") elif (.schema // "") != "pretty-index-checksum-mismatch/v1" then bad("schema must be pretty-index-checksum-mismatch/v1 (got: \(.schema // "<missing>"))") elif ([.scope] | inside(["atomic","stress","both"]) | not) then bad("scope must be atomic|stress|both (got: \(.scope // "<missing>"))") elif (.results | type) != "array" then bad(".results must be an array") elif (.fail_fast != null and (.fail_fast | type) != "boolean") then bad(".fail_fast must be boolean when present") else ([ .results | to_entries[] | . as $$e | ($$e.value // {}) as $$r | if ($$r | type) != "object" then "results[\($$e.key)] must be object" elif ([$$r.status] | inside(["OK","MISMATCH","dir_missing","checksums_missing"]) | not) then "results[\($$e.key)].status invalid: \($$r.status // "<missing>")" elif ($$r.status == "OK" or $$r.status == "MISMATCH") and (($$r.file // "") == "" or ($$r.expected == null) or ($$r.actual == null)) then "results[\($$e.key)] file-result must have file/expected/actual" elif (($$r.dir // "") == "") then "results[\($$e.key)].dir missing" else empty end ] | if length == 0 then "" else bad(.[0]) end) end' -- "$(PI_REPORT_PATH)" 2>&1); \
	if [ -n "$$err" ]; then echo "$$err" >&2; echo "invalid: $(PI_REPORT_PATH)" >&2; exit 1; fi; \
	echo "✅ $(PI_REPORT_PATH) validates against pretty-index-checksum-mismatch/v1"

# End-to-end CI-parity pipeline that runs summary-json, summary-validate
# (with --report-json), summary-md, and diff-report on a local mismatch
# report. When mismatches are present (recipe exits 3) and PI_CI_BUNDLE_PATH
# is set, all generated artifacts are bundled into a single .tar.gz
# tarball for easy upload as a CI artifact.
#
#   PI_REPORT_PATH=<in>           mismatch report to process
#   PI_BASELINE=<path>            optional baseline for diff (skipped if absent)
#   PI_CI_OUT_DIR=<dir>           where to write generated files (default: ./_pretty-index-ci)
#   PI_CI_BUNDLE_PATH=<file.tgz>  tarball path (default: <PI_CI_OUT_DIR>.tar.gz)
PI_CI_OUT_DIR     ?= _pretty-index-ci
PI_CI_BUNDLE_PATH ?= $(PI_CI_OUT_DIR).tar.gz
pretty-index-mismatch-ci:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@if [ ! -f "$(PI_REPORT_PATH)" ]; then \
	  echo "no mismatch report at $(PI_REPORT_PATH) — run verify first" >&2; exit 2; \
	fi
	@rm -rf -- "$(PI_CI_OUT_DIR)"; mkdir -p -- "$(PI_CI_OUT_DIR)"
	@echo "── pretty-index CI pipeline → $(PI_CI_OUT_DIR) ──"
	@# Pre-create validate report + annotations so the tarball ALWAYS contains
	@# them (even when empty), keeping failure debugging consistent.
	@: > "$(PI_CI_OUT_DIR)/validate-report.json"
	@: > "$(PI_CI_OUT_DIR)/validate-annotations.txt"
	@$(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-summary-json \
	  PI_REPORT_PATH="$(PI_REPORT_PATH)" \
	  PI_SUMMARY_JSON_PATH="$(PI_CI_OUT_DIR)/summary.json"
	@set +e; \
	 $(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-summary-validate \
	   PI_SUMMARY_JSON_PATH="$(PI_CI_OUT_DIR)/summary.json" \
	   PI_VALIDATE_REPORT_JSON="$(PI_CI_OUT_DIR)/validate-report.json" \
	   2> "$(PI_CI_OUT_DIR)/validate-annotations.txt"; \
	 vrc=$$?; cat "$(PI_CI_OUT_DIR)/validate-annotations.txt" >&2; \
	 # Strict jq schema assertion on validate-report.json via the shared \
	 # `pretty-index-validate-report-check` target. Its stderr is captured \
	 # into $(PI_CI_OUT_DIR)/validate-schema-assertion.txt so the file is \
	 # ALWAYS bundled (empty on pass, populated on fail) for CI triage. \
	 sa="$(PI_CI_OUT_DIR)/validate-schema-assertion.txt"; : > "$$sa"; \
	 $(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory \
	   pretty-index-validate-report-check \
	   VALIDATE_REPORT_JSON="$(PI_CI_OUT_DIR)/validate-report.json" \
	   2> "$$sa"; \
	 src=$$?; cat "$$sa" >&2; \
	 if [ "$$src" -ne 0 ] || [ "$$vrc" -ne 0 ]; then \
	   echo "packaging partial bundle (schema-check=$$src validate=$$vrc) -> $(PI_CI_BUNDLE_PATH)" >&2; \
	   tar -czf "$(PI_CI_BUNDLE_PATH)" -C "$$(dirname -- "$(PI_CI_OUT_DIR)")" "$$(basename -- "$(PI_CI_OUT_DIR)")"; \
	   if [ "$$src" -ne 0 ]; then exit "$$src"; else exit "$$vrc"; fi; \
	 fi
	@$(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-summary-md \
	  PI_SUMMARY_JSON_PATH="$(PI_CI_OUT_DIR)/summary.json" \
	  PI_SUMMARY_MD_PATH="$(PI_CI_OUT_DIR)/summary.md"
	@if [ -n "$(PI_BASELINE)" ] && [ -f "$(PI_BASELINE)" ]; then \
	   set +e; \
	   $(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-diff \
	     PI_BASELINE="$(PI_BASELINE)" \
	     PI_REPORT_PATH="$(PI_REPORT_PATH)" \
	     PI_DIFF_OUT_PATH="$(PI_CI_OUT_DIR)/diff.json"; \
	   drc=$$?; \
	   if [ "$$drc" -ne 0 ] && [ "$$drc" -ne 2 ]; then :; fi; \
	 else \
	   echo "skip diff: PI_BASELINE unset or missing"; \
	 fi
	@mm=$$(jq -r '.totals.mismatched + .totals.missing' -- "$(PI_CI_OUT_DIR)/summary.json"); \
	 echo "pipeline artifacts:"; ls -1 "$(PI_CI_OUT_DIR)"; \
	 if [ "$$mm" -gt 0 ]; then \
	   tar -czf "$(PI_CI_BUNDLE_PATH)" -C "$$(dirname -- "$(PI_CI_OUT_DIR)")" "$$(basename -- "$(PI_CI_OUT_DIR)")"; \
	   echo "bundled mismatched artifacts -> $(PI_CI_BUNDLE_PATH)"; \
	   echo "bundle contents:"; tar -tzf "$(PI_CI_BUNDLE_PATH)"; \
	   exit 3; \
	 else \
	   echo "no mismatches; skipping bundle"; \
	 fi

# Self-test that generates a minimal synthetic mismatch fixture and runs
# `pretty-index-mismatch-ci` against it end-to-end. Used to verify CI
# parity on fresh checkouts without needing a real replay run.
#
#   PI_CI_SELFTEST_DIR=<dir>     scratch dir (default: ./_pi-ci-selftest)
#   PI_CI_SELFTEST_SCOPE=<name>  scope/matrix label (default: atomic)
PI_CI_SELFTEST_DIR   ?= _pi-ci-selftest
PI_CI_SELFTEST_SCOPE ?= atomic
.PHONY: pretty-index-mismatch-ci-selftest pretty-index-mismatch-ci-selftest-all
pretty-index-mismatch-ci-selftest:
	@command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
	@rm -rf -- "$(PI_CI_SELFTEST_DIR)"; mkdir -p -- "$(PI_CI_SELFTEST_DIR)"
	@echo "── synthesizing minimal mismatch fixture (scope=$(PI_CI_SELFTEST_SCOPE)) → $(PI_CI_SELFTEST_DIR) ──"
	@jq -n --arg s "$(PI_CI_SELFTEST_SCOPE)" '{schema:"pretty-index-checksum-mismatch/v1", scope:$$s, matrix:$$s, fail_fast:false, results:[{status:"MISMATCH", dir:("synthetic/"+$$s), file:"pretty-index.json", expected:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actual:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}, {status:"OK", dir:("synthetic/"+$$s), file:"other.json", expected:"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", actual:"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]}' > "$(PI_CI_SELFTEST_DIR)/report.json"
	@set +e; \
	 $(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-ci \
	   PI_REPORT_PATH="$(PI_CI_SELFTEST_DIR)/report.json" \
	   PI_CI_OUT_DIR="$(PI_CI_SELFTEST_DIR)/out" \
	   PI_CI_BUNDLE_PATH="$(PI_CI_SELFTEST_DIR)/bundle.tar.gz"; \
	 rc=$$?; \
	 if [ "$$rc" -ne 2 ] && [ "$$rc" -ne 3 ]; then \
	   echo "selftest FAILED (scope=$(PI_CI_SELFTEST_SCOPE)): expected exit=2|3, got $$rc" >&2; exit 1; \
	 fi; \
	 for f in validate-report.json validate-annotations.txt summary.json summary.md; do \
	   [ -f "$(PI_CI_SELFTEST_DIR)/out/$$f" ] || { echo "selftest FAILED (scope=$(PI_CI_SELFTEST_SCOPE)): missing $$f" >&2; exit 1; }; \
	 done; \
	 [ -f "$(PI_CI_SELFTEST_DIR)/bundle.tar.gz" ] || { echo "selftest FAILED (scope=$(PI_CI_SELFTEST_SCOPE)): bundle not produced" >&2; exit 1; }; \
	 echo "✅ pretty-index-mismatch-ci selftest passed (scope=$(PI_CI_SELFTEST_SCOPE), bundle: $(PI_CI_SELFTEST_DIR)/bundle.tar.gz)"

# Run the selftest for BOTH atomic and stress fixture sets. Confirms
# CI parity for both matrices on a fresh checkout.
pretty-index-mismatch-ci-selftest-all:
	@$(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-ci-selftest \
	  PI_CI_SELFTEST_SCOPE=atomic PI_CI_SELFTEST_DIR=_pi-ci-selftest-atomic
	@$(MAKE) -f $(firstword $(MAKEFILE_LIST)) --no-print-directory pretty-index-mismatch-ci-selftest \
	  PI_CI_SELFTEST_SCOPE=stress PI_CI_SELFTEST_DIR=_pi-ci-selftest-stress
	@echo "✅ pretty-index-mismatch-ci-selftest-all: atomic + stress passed"

