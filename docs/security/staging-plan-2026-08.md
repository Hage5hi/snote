# G3 staging plan — split, fail-closed gates

Status: G2 closed at `f712a99c`. G3 planning starts from the docs-only
candidate `75c61c46`; the immutable staging SHA will be the final reviewed G3A
implementation head, not either historical SHA. The release remains NO-GO for
merge or deployment until the applicable gates below have passed.

No G3 step may use production data, the production Supabase project reference,
or a production hostname. No secret value may enter the repository, chat,
command output, logs, test artifacts, or evidence.

## G3A — repository readiness

G3A is the current, repository-only change:

- `VITE_CAPABILITY_ROUTES_ENABLED` activates the existing single-note
  capability route only when its exact build-time value is `true`; missing or
  malformed values preserve legacy-only routing, and Split View remains
  legacy-only until it has a per-pane capability format;
- `bun run staging:prepare` requires clean Git-tracked Supabase sources, rejects
  ambient or linked state, and creates a disposable OS-temp workdir containing
  Edge Function sources plus an explicit allowlist of additive migrations;
- the generated config uses `snote-staging-local`, binds the capability HMAC
  only from the launching process environment, and its manifest records the
  reviewed commit plus SHA-256 hashes for config, functions, and migrations;
- `20260724000000_atomic_capability_cutover.sql` is excluded.

G3A does not run Docker or the Supabase CLI, link a project, create an account,
generate a secret, deploy, merge PR #10, or mutate production. Its output is
readiness code and local test evidence, not staging evidence.

G3A is complete only when route tests prove exact opt-in with Split View still
legacy-only, generator tests prove the allowlist and reviewed-commit bytes,
an actual staging build contains the staging CSP instead of the production
backend, and the existing quality, type, unit, build, audit, extension, and
browser-discovery gates remain green on the final reviewed SHA.

## G3B — local polling rehearsal

G3B requires separate owner approval. It is local-only and may start only when
the G3A head is reviewed, the worktree is clean, the Docker engine is healthy,
disk capacity is sufficient, the exact Supabase CLI version is recorded, and
no untrusted local principal can read the disposable workdir. It creates no
account and contacts no remote project.

### Workdir and migration procedure

Run the generator from the reviewed checkout and record its emitted path:

```powershell
bun run staging:prepare
$GeneratedWorkdir = "<path emitted by staging:prepare>"
```

Before exporting any runtime-only secret, verify that the manifest source
commit is the reviewed checkout HEAD, every manifest hash matches its generated
file, all 22 allowlisted migrations are present, the atomic cutover migration
is absent, and the generated config contains `snote-staging-local` but not the
production project ref. Only after those checks pass, continue in the same
shell:

```powershell
$SupabaseCliVersion = (bunx supabase@2.115.0 --workdir $GeneratedWorkdir --version 2>$null).Trim()
if ($SupabaseCliVersion -ne "2.115.0") { throw "Unexpected Supabase CLI version" }
if (Test-Path Env:CAPABILITY_HMAC_SECRET) {
  throw "CAPABILITY_HMAC_SECRET already exists in this shell"
}
$RuntimeSecretCache = Join-Path $GeneratedWorkdir "supabase/.temp/start-secrets"
$LocalStatus = $null
$LocalEnv = $null
$SecretBytes = New-Object byte[] 32
$SecretRng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $SecretRng.GetBytes($SecretBytes)
  $env:CAPABILITY_HMAC_SECRET = -join ($SecretBytes | ForEach-Object { $_.ToString("x2") })
  [Array]::Clear($SecretBytes, 0, $SecretBytes.Length)
  $null = bunx --no-install supabase@2.115.0 --workdir $GeneratedWorkdir start 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local Supabase startup failed" }
  $null = bunx --no-install supabase@2.115.0 --workdir $GeneratedWorkdir db reset --local 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local database reset failed" }
  $LocalStatus = bunx --no-install supabase@2.115.0 --workdir $GeneratedWorkdir status -o env 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Unable to read local Supabase status" }
  $LocalEnv = ConvertFrom-StringData ($LocalStatus -join "`n")
  $LocalApiUrl = $LocalEnv.API_URL.Trim('"')
  $LocalPublishableKey = $LocalEnv.ANON_KEY.Trim('"')
  if (!$LocalApiUrl -or !$LocalPublishableKey) { throw "Incomplete local Supabase status" }
} catch {
  $StartupError = $_
  $null = bunx --no-install supabase@2.115.0 --workdir $GeneratedWorkdir stop 2>&1
  $StopExitCode = $LASTEXITCODE
  if (Test-Path -LiteralPath $RuntimeSecretCache) {
    Remove-Item -LiteralPath $RuntimeSecretCache -Recurse -Force -ErrorAction Stop
  }
  if (Test-Path -LiteralPath $RuntimeSecretCache) {
    throw "Failed to remove Supabase runtime secret cache"
  }
  if ($StopExitCode -ne 0) {
    throw "Supabase stop failed; local stack state is unknown"
  }
  throw $StartupError
} finally {
  if ($null -ne $LocalEnv) { $LocalEnv.Clear() }
  $LocalEnv = $null
  $LocalStatus = $null
  [Array]::Clear($SecretBytes, 0, $SecretBytes.Length)
  $SecretBytes = $null
  $SecretRng.Dispose()
  $SecretRng = $null
  if (Test-Path Env:CAPABILITY_HMAC_SECRET) {
    Remove-Item Env:CAPABILITY_HMAC_SECRET -ErrorAction Stop
  }
  if (Test-Path Env:CAPABILITY_HMAC_SECRET) {
    throw "Failed to clear local capability HMAC secret"
  }
}
```

`RandomNumberGenerator.Create()` works on Windows PowerShell 5.1 and fills a
32-byte buffer without printing the secret. The generated config declares
`CAPABILITY_HMAC_SECRET = "env(CAPABILITY_HMAC_SECRET)"`, so the value originates
only in the current process environment. Supabase CLI 2.115.0 then materializes
the merged Edge Runtime environment under
`supabase/.temp/start-secrets/<runtime>/env/docker.env` inside the disposable
workdir for Docker; this flow is not fileless. Treat that whole workdir as
sensitive while the stack runs and never copy its `.temp` tree into evidence.
The byte buffer is cleared, the RNG is disposed, and the parent-shell entry is
removed and its absence verified whether startup succeeds or fails. Startup
output is discarded because it includes local JWT credentials. Raw status is
cleared in `finally`, including parse and missing-key failures; never print or
persist it.

`--workdir` is the Supabase global project-directory flag; `db reset --local`
recreates the local database and applies only migrations copied into that
generated directory. Never use the source checkout as the workdir and never use
an ambient linked project. Before any functional probe, also verify that the
database ledger contains exactly the allowlisted timestamps in order and that
direct protected-table access is denied for both `anon` and `authenticated`.

### Runtime sequence

The additive migration initializes `writes=false, privateRealtime=false`.
Keep that state while proving API failure paths, protected-table denials, note-A
versus note-B isolation, and service-role-only runtime controls. Only after those
checks pass may the local test window call `capability_runtime_set(true, false)`,
which yields `writes=true, privateRealtime=false`.

Before building the local SPA, set all four values in the current PowerShell
process; never rely on the committed `.env` fallback:

```powershell
$StagingBuildEnvKeys = @(
  "VITE_CAPABILITY_ROUTES_ENABLED",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY"
)
$ExistingStagingBuildEnv = @($StagingBuildEnvKeys | Where-Object {
  Test-Path -LiteralPath "Env:$_"
})
if ($ExistingStagingBuildEnv.Count -ne 0) {
  throw "Staging build environment already exists in this shell"
}
try {
  $env:VITE_CAPABILITY_ROUTES_ENABLED = "true"
  $env:VITE_SUPABASE_PROJECT_ID = "snote-staging-local"
  $env:VITE_SUPABASE_URL = $LocalApiUrl
  $env:VITE_SUPABASE_PUBLISHABLE_KEY = $LocalPublishableKey
  bun run build:check
  if ($LASTEXITCODE -ne 0) { throw "Staging build failed" }
  $ProductionProjectRef = "onfzjmfjldsbthchssfr"
  $ProductionLeak = Get-ChildItem dist -Recurse -File |
    Select-String -SimpleMatch $ProductionProjectRef |
    Select-Object -First 1
  if ($null -ne $ProductionLeak) {
    throw "Production Supabase reference found in the staging artifact"
  }
} finally {
  $ProductionLeak = $null
  foreach ($Name in $StagingBuildEnvKeys) {
    Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
  }
  foreach ($Name in $StagingBuildEnvKeys) {
    if (Test-Path -LiteralPath "Env:$Name") {
      throw "Failed to clear staging build environment"
    }
  }
}
```

The build itself fails closed if capability routes resolve to the production
project ID or canonical production Supabase hostname, and rewrites the static
CSP fallback to the verified staging backend. Keep managed Auth disabled so the
API returns polling sessions. G3B may claim only:

- owner/edit/view scope isolation and cross-note denial;
- idempotent replay, reversed/concurrent saves, and checkpoint conflict codes;
- encrypted round-trip and locked-note plaintext exclusion;
- IndexedDB outbox acknowledgement, reconnect, reopen, and navigation under
  800 ms without losing an update;
- revoke/rotate behavior, oversized-update quarantine, and legacy exact-match
  read-only access;
- stalled PWA update retains the active offline application.

The private Realtime path is out of scope for G3B. On any failure and again
during normal teardown, return to `false,false`, record the terminal state, stop
the generated local stack with the command below, and retain only redacted
evidence:

```powershell
$null = bunx --no-install supabase@2.115.0 --workdir $GeneratedWorkdir stop 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Supabase stop failed; local stack state is unknown"
}
```

Only after that command returns zero, remove and verify the absence of
`$GeneratedWorkdir/supabase/.temp/start-secrets`, then delete and verify the
absence of the entire disposable workdir. If the CLI, shell, or host is
interrupted, perform that cleanup before resuming any other work. The local HMAC
is synthetic and must never be reused outside this one rehearsal.

## G3C — hosted staging

G3C requires separate owner approval. It creates an isolated staging Supabase
project and staging-only Cloudflare endpoint. Production data, credentials,
hostnames, DNS routes, and the production project ref remain forbidden.

### Auth, Realtime, and runtime

Hosted staging must enable and prove anonymous Auth, a staging Turnstile site
key, `VITE_CAPABILITY_AUTH_ENABLED=true`, and the same exact capability-route
flag. The private Realtime path may be enabled only after polling passes and
five-minute JWT issuance/refresh, private-channel RLS, membership cleanup, and
redacted logging are verified. Failure returns runtime state to `false,false`;
it never falls back by opening public Realtime.

### Functions and gateway boundary

Before deploy, write a desired-state table for every committed Edge Function.
Each row must state deployed/tombstoned/omitted, source hash, deployed version,
route exposure, and `verify_jwt` mode. The inventory must explicitly decide
`raw` and `share-revoke`; no function inherits an assumed gateway setting.

Client-supplied forwarding headers must be tested through the real gateway for
both admin login and capability note create/import. Continue only when the
gateway overwrites spoofed values with one valid address literal. Otherwise
those admission paths remain fail-closed with `503`.

### Synthetic data and recovery

Normal fixtures use public APIs. Exceptional legacy and quarantine fixtures may
use a reviewed staging-only SQL/service-role seed whose provenance, assertions,
and cleanup are recorded. No production backup is imported.

Free-tier recovery uses a manual logical dump, checksum, restore rehearsal, and
post-restore core probes. The procedure must separately account for anonymous
Auth users needed by the Realtime test. Do not claim recovery until the restored
project reproduces the expected ledger, runtime state, users, and probe results.

### Edge containment and immutable evidence

The staging Worker must use a non-redirecting staging origin and prove generic
`no-store`/`noindex` crawler responses, analytics-path denial, cache purge, and
logs without content, ciphertext, slug, token, fragment, private path, or raw
IP. The final evidence bundle records:

- SPA source SHA and build ID;
- Edge Function source hashes and deployed versions;
- Worker deployment ID, routes, and config hash;
- generated-file SHA-256 hashes plus the applied migration ledger;
- staging project ref and region;
- runtime flags and Auth mode, Turnstile mode, JWT lifetime, and Realtime mode;
- gateway overwrite, API, browser, rollback, and restore results;
- a final redaction scan over every shareable artifact.

The evidence bundle uses synthetic opaque fixture labels and contains no secret
or private value. Independent review of the exact bundle and exact deployed SHA
is required before G3 can close.

## Hard stops after G3

G3 does not authorize atomic cutover, production deployment, PR #10 merge,
production table revocation, production cache purge, or the 48-hour production
soak. Those remain later gates with their own backup and rollback checkpoints.
