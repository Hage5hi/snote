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


.PHONY: help pretty-index-check pretty-index-check-clean \
        pretty-index-check-pwsh pretty-index-diagnostics pretty-index-clean \
        pretty-index-clean-dry-run \
        pretty-index-artifacts pretty-index-hook-dry-run




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
