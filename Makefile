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
        pretty-index-artifacts pretty-index-hook-dry-run \
        pretty-index-artifacts-download \
        pretty-index-artifacts-verify \
        pretty-index-hook-validate-downloaded




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

