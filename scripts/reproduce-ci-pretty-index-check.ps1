#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Windows PowerShell port of scripts/reproduce-ci-pretty-index-check.sh.

.DESCRIPTION
  Reproduces the CI pretty-index check flow locally:
    1. snapshot the generator output (pretty-index.pre-check.json)
    2. run the generator self-check + strict validator via
       scripts/check-pretty-index-schema-version.py and
       scripts/validate-pretty-index.py --require-version 1 --report
    3. on failure, print a GitHub Actions step-summary-style block
       naming the exact files CI would upload as failure artifacts.

.PARAMETER Index
  Path to the pretty-index.json to check. Defaults to
  artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json
  (matching the CI matrices).

.PARAMETER Clean
  Remove any pre-existing sibling .pre-check.json / .report.json BEFORE
  running so the diagnostic state is fresh.

.PARAMETER Keep
  (default) Leave existing diagnostic artifacts in place so successive
  runs preserve history for debugging.

.EXAMPLE
  pwsh scripts/reproduce-ci-pretty-index-check.ps1
  pwsh scripts/reproduce-ci-pretty-index-check.ps1 -Clean path\to\pretty-index.json

  Exit codes mirror check-pretty-index-local.sh:
    0 ok  1 drift  2 usage  3 schema  4 missing file
#>
[CmdletBinding()]
param(
  [string]$Index = "artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json",
  [switch]$Clean,
  [switch]$Keep
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path -LiteralPath $Index -PathType Leaf)) {
  Write-Error "reproduce-ci-pretty-index-check: file not found: $Index"
  exit 4
}

$stem   = [IO.Path]::ChangeExtension($Index, $null).TrimEnd('.')
$pre    = "$stem.pre-check.json"
$report = "$stem.report.json"

if ($Clean) {
  Write-Host "==> --Clean: removing prior diagnostics ($pre, $report)"
  Remove-Item -LiteralPath $pre, $report -ErrorAction SilentlyContinue
}

Write-Host "==> [0/2] snapshot generator output -> $pre"
Copy-Item -LiteralPath $Index -Destination $pre -Force

Write-Host "==> [1/2] generator self-check (schema_version drift)"
& python3 (Join-Path $here 'check-pretty-index-schema-version.py') $Index
$rc = $LASTEXITCODE
if ($rc -eq 0) {
  Write-Host "==> [2/2] validator --require-version 1 --report $report"
  $dir = Split-Path -Parent $report
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  & python3 (Join-Path $here 'validate-pretty-index.py') `
      --require-version 1 --report $Index | Set-Content -LiteralPath $report -Encoding utf8
  $rc = $LASTEXITCODE
}

if ($rc -ne 0) {
  $msg = @"

################################################################################
# X pretty-index.json check failed (exit $rc)
#
# In CI this would upload the following artifact and append a link block
# to `$GITHUB_STEP_SUMMARY:
#
#   artifact: schema-drift-diff-replay-pretty-index-failure-<os>
#     - $Index
#     - $pre    (raw generator output BEFORE --auto-migrate)
#     - $report (validator --report machine-readable errors)
#
# Exit code legend: 1=schema drift, 3=schema validation, 4=missing file
# Re-run with -Clean to discard prior diagnostics, or -Keep (default)
# to preserve them for debugging.
################################################################################
"@
  [Console]::Error.WriteLine($msg)

  if ($env:GITHUB_STEP_SUMMARY) {
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value @"

### ❌ pretty-index.json CI check failed (exit $rc)

Failure diagnostics (would be uploaded as artifact
`schema-drift-diff-replay-pretty-index-failure-windows`):

- ``$Index``
- ``$pre`` — raw generator output before ``--auto-migrate``
- ``$report`` — validator ``--report`` machine-readable errors
"@
  }
  exit $rc
}

Write-Host ""
Write-Host "OK: pretty-index.json passes the same check CI runs."
Write-Host "   report: $report"
Write-Host "   pre-check snapshot: $pre"
