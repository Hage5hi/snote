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
	report="$(PI_MISMATCH_REPORT)"; \
	rm -f -- "$$report"; \
	first=1; \
	printf '{"schema":"pretty-index-checksum-mismatch/v1","scope":"$(PI_SCOPE)","results":[' > "$$report.tmp"; \
	for dir in $$dirs; do \
	  if [ ! -d "$$dir" ]; then \
	    echo "❌ $$dir missing — run 'make pretty-index-artifacts-download RUN_ID=...' first" >&2; \
	    [ $$first -eq 1 ] || printf ',' >> "$$report.tmp"; first=0; \
	    printf '{"dir":"%s","status":"dir_missing"}' "$$dir" >> "$$report.tmp"; \
	    rc=2; continue; \
	  fi; \
	  if [ ! -f "$$dir/pretty-index.checksums.sha256" ]; then \
	    echo "❌ $$dir/pretty-index.checksums.sha256 missing — artifact was uploaded without checksums" >&2; \
	    [ $$first -eq 1 ] || printf ',' >> "$$report.tmp"; first=0; \
	    printf '{"dir":"%s","status":"checksums_missing"}' "$$dir" >> "$$report.tmp"; \
	    rc=2; continue; \
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
	          printf '{"dir":"%s","file":"%s","expected":"%s","actual":"%s","status":"%s"}' \
	            "$$dir" "$$fname" "$$exp" "$$act" "$$status" >> "$$report.tmp"; \
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


