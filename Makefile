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
        pretty-index-diagnostics pretty-index-clean

help:
	@echo "Targets:"
	@echo "  pretty-index-check          Run the CI pretty-index check flow locally."
	@echo "  pretty-index-check-clean    Same, but discard prior diagnostics first."
	@echo "  pretty-index-diagnostics    Print where diagnostic artifacts are written."
	@echo "  pretty-index-clean          Remove sibling .pre-check.json / .report.json."
	@echo ""
	@echo "Override the input file with: make pretty-index-check INDEX=path/to/pretty-index.json"

pretty-index-check:
	@scripts/reproduce-ci-pretty-index-check.sh "$(INDEX)"
	@$(MAKE) --no-print-directory pretty-index-diagnostics

pretty-index-check-clean:
	@scripts/reproduce-ci-pretty-index-check.sh --clean "$(INDEX)"
	@$(MAKE) --no-print-directory pretty-index-diagnostics

pretty-index-diagnostics:
	@echo ""
	@echo "pretty-index diagnostics artifacts:"
	@echo "  input       : $(INDEX)"
	@echo "  pre-check   : $(PRE)     (raw generator output, uploaded on CI failure)"
	@echo "  report JSON : $(REPORT)  (validator --report, uploaded on CI failure)"
	@echo ""
	@echo "CI uploads these as: schema-drift-diff-replay-pretty-index-failure-<os>"

pretty-index-clean:
	@rm -f -- "$(PRE)" "$(REPORT)"
	@echo "removed: $(PRE) $(REPORT)"
