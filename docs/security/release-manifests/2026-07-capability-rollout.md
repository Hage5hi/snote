# Snote Capability Rollout Release Manifest

Status: `PREPARATION - NO PRODUCTION MUTATION AUTHORIZED`

Last reviewed: 2026-07-28 (Asia/Saigon)

This manifest contains sanitized identifiers and aggregate evidence only. Do not
record note content, ciphertext, slugs, capabilities, share tokens, raw private
URLs, raw IP addresses, passwords, keys, session cookies, or secret values.

## Release identity

- Repository: `sovergarden-dev/snote`
- Canonical production origin: `https://note.syrin.online`
- Approved baseline SHA: `241be9fe79a4d4956fc5bec88d73c2c1b108f9f5`
- Current candidate SHA: `UNSET`
- Current candidate branch: `security/edge-privacy-containment`
- Deployed build ID: `5bfc10bd-bde7-4b47-aebe-5be33d2391c1`
- Lovable deployment ID: `5bfc10bd-bde7-4b47-aebe-5be33d2391c1`
- Cloudflare Worker version: `ac380357` (dashboard prefix)
- Worker origin: `UNSET`
- Production cutover time: `UNSET`
- Legacy compatibility cutoff: `UNSET`

## Change-control gates

- [x] Master implementation plan approved.
- [x] Isolated implementation worktree confirmed.
- [x] Temporary local PR A branch created from the approved baseline.
- [x] Tracking issue created: `https://github.com/sovergarden-dev/snote/issues/9`.
- [ ] Production freeze acknowledged by the operator.
- [ ] Cloudflare/Lovable production mutation approved.
- [ ] Production database/Edge Function mutation approved.
- [ ] Production backup or encrypted export approved and verified.
- [ ] Production additive deployment approved.
- [ ] Exact release candidate approved for the 48-hour soak.
- [ ] Atomic cutover explicitly approved after the soak.
- [ ] 30-day compatibility retirement approved.
- [ ] Dirty local-worktree cleanup approved.

## GitHub baseline evidence

Read-only GitHub connector inventory on 2026-07-28:

- Default branch: `main`
- Remote branches: `main` only
- Remote `main` SHA: `241be9fe79a4d4956fc5bec88d73c2c1b108f9f5`
- Open pull requests: 0
- Open issues before tracking setup: 0
- Open issues after tracking setup: 1 (tracking issue #9)
- Repository visibility: public
- Repository access observed by connector: admin
- Merge methods currently enabled: merge, rebase, and squash
- Auto-merge: disabled
- Commit status endpoint: no status contexts returned for the baseline SHA
- PR-triggered workflow lookup: no workflow runs returned for the baseline SHA

The absent status results above are not evidence that CI is green. They are
recorded as `UNPROVEN` until the required GitHub checks report on a real PR and
the post-deploy workflow reports for a deployed SHA.

## Local baseline evidence

Environment:

- Bun: `1.3.14`
- Lockfile: `bun.lock`
- Baseline worktree SHA: `241be9fe79a4d4956fc5bec88d73c2c1b108f9f5`

Commands:

```powershell
bun install --frozen-lockfile --dry-run --no-progress --ignore-scripts
bun run test:coverage
```

Result:

- Frozen-lockfile dry run: passed
- Test files: 108 passed
- Tests: 1,169 passed
- Test failures: 0
- Coverage command duration: 65.03 seconds
- Aggregate statement coverage: 57.73%

The test output contains expected test-fixture console messages. No failing test
or dependency-resolution drift was observed.

## Cloudflare production inventory

Authenticated, read-only dashboard inventory and synthetic HTTP probes were
completed on 2026-07-28. No settings were changed. Raw cookies, account
identifiers, DNS verification records, private paths, and request URLs were not
retained.

- Account identifier: `REDACTED`
- Worker name: `syrin-prerender`
- Active Worker version: `ac380357` (dashboard prefix), 100% traffic
- Deployment source/age: manual Wrangler deployment, approximately two months
  old
- Deployed routes: `syrin.online/*` and `www.syrin.online/*`
- Missing deployed route: `note.syrin.online/*`
- Worker development URL: enabled
- Worker observability: disabled in the dashboard
- DNS:
  - `note.syrin.online`: DNS-only A record
  - `syrin.online`: proxied CNAME to the Lovable alias
  - `www.syrin.online`: proxied CNAME to the Lovable alias
- Direct Lovable alias: redirects its root to the canonical origin
- `/~flock.js` edge deny: not deployed; synthetic GET returned JavaScript with
  a cacheable response
- `/~api/analytics` edge deny: not deployed; synthetic GET reached the
  application origin and returned HTML
- Canonical private-route cache policy: not deployed; a synthetic private path
  returned origin HTML without the required private response policy
- Apex private-route cache/indexing policy: unsafe; the deployed Worker returned
  a cacheable, indexable prerender response for the synthetic private path
- Raw URL/request logging state: Worker observability is disabled, but complete
  request-log redaction remains `UNPROVEN`
- Cache purge state: `NOT STARTED`

## Lovable-managed backend inventory

Authenticated, read-only Lovable inventory was completed on 2026-07-28. No
switches, secrets, functions, database rows, backups, or deployment settings
were changed.

- Lovable project identifier: `REDACTED`
- Managed backend project reference: `onfzjmfjldsbthchssfr`
- Region: `UNVERIFIED`
- Deployed application build: `5bfc10bd-bde7-4b47-aebe-5be33d2391c1`
- Production tables observed:
  - `notes`: 51 rows
  - `note_shares`: 0 rows
  - `admin_config`: 0 rows
- Deployed Edge Function count: 11
- Deployed legacy functions:
  - `admin-delete`
  - `admin-list`
  - `cleanup`
  - `admin-rotate`
  - `raw`
  - `share-create`
  - `share-rename`
  - `share-revoke`
  - `share-view`
  - `note-meta`
  - `old-slug-cleanup-status`
- Migration ledger: `UNVERIFIED`
- Authenticated users: 0
- Email authentication: enabled
- Google authentication: enabled
- New-user sign-up: allowed
- Anonymous authentication: disabled
- Turnstile/CAPTCHA: `UNVERIFIED`
- Realtime authorization mode: `UNVERIFIED`
- Lovable analytics: enabled and recording path-level, country, and device
  telemetry; no private path values were copied into this manifest
- Analytics retention/deletion state: `UNVERIFIED`
- Security warnings: 4
  - admin brute-force protection missing
  - unauthenticated share-token management
  - optional/silently-disabled `note-meta` authentication
  - always-true RLS policy
- Dependency warnings reported by Lovable: 26 known vulnerabilities across 72
  packages
- Backup availability: daily backups visible
- Latest visible backup: 2026-07-27 19:24:42 UTC
- Restore rehearsal: `UNPROVEN`

## Secret-name inventory

Record only whether a required secret name is present. Never add its value or a
reversible fingerprint here.

- Lovable-managed `LOVABLE_API_KEY`: present
- Legacy `NOTE_META_SECRET`: present
- Legacy `ADMIN_PASSPHRASE`: present
- `SUPABASE_SERVICE_ROLE_KEY`: not listed in the project-secret table
- `ADMIN_PASSWORD_HASH`: not listed in the project-secret table
- `ADMIN_SESSION_SECRET`: not listed in the project-secret table
- Turnstile server secret name: not listed in the project-secret table
- Turnstile site key variable name: `UNVERIFIED`
- GitHub production dispatch credential: `UNVERIFIED`
- Cloudflare deployment credential: `UNVERIFIED`

## Local schema and Edge Function inventory

The repository contains the migration and function source used for rollout.
Applied production state must be compared separately.

- Capability backend contract: present in source
- Capability conflict-prevention contract: present in source
- Atomic capability cutover contract: present in source
- Cutover verifier: `scripts/verify-capability-cutover.ts`
- Anonymous-auth cleanup function: not yet implemented
- Soak verifier: not yet implemented
- Lovable Remix staging Playwright gate: not yet implemented

Known migration-order decision:

- If the atomic cutover migration has not run, sequence it after conflict
  prevention and prove the complete order in a fresh database.
- If it has run in an environment that matters, preserve history and add a new
  forward-only corrective migration.
- Never run an unreviewed blanket database push.

## Backup and recovery

- Latest visible managed backup: 2026-07-27 19:24:42 UTC
- Release-specific backup/checkpoint: `NOT CREATED`
- Backup mechanism: Lovable-managed daily backup
- Encryption at rest for exported artifact: `UNVERIFIED`
- Restore rehearsal environment: `UNSET`
- Restore rehearsal result: `UNPROVEN`
- Paid-plan requirement: `UNVERIFIED`

No production migration or Edge Function deployment may proceed while recovery
remains `UNPROVEN`.

## Rollout mode

- Initial sync transport: polling
- Private Realtime: disabled unless every managed-JWT/redaction gate is proven
- Capability writes at staging start: disabled
- Legacy compatibility at staging start: disabled
- Safe rollback posture:

```sql
select public.capability_runtime_set(false, false);
```

The exact function signature must be verified against the applied schema before
this statement is used outside a disposable environment.

## Evidence log

### 2026-07-28 - plan and baseline

- Master plan saved at
  `docs/superpowers/plans/2026-07-28-snote-production-security-rollout.md`.
- Local branch `security/edge-privacy-containment` created from the approved
  baseline.
- GitHub connector confirmed the remote branch and commit inventory.
- Sanitized rollout tracking issue created as GitHub issue #9.
- Local frozen install and full coverage suite passed.
- No Cloudflare, Lovable, database, Edge Function, DNS, cache, auth, secret, or
  production deployment setting was changed.

### 2026-07-28 - production inventory

- Cloudflare readback proved that the deployed Worker is stale relative to the
  repository configuration and does not cover the canonical host.
- Synthetic probes used a single non-user path and retained only sanitized
  status/header outcomes.
- The analytics endpoints are not denied at the canonical edge.
- A synthetic private route remains cacheable/indexable through the apex Worker.
- Lovable analytics is active and records path-level telemetry.
- Lovable reports four security warnings and 26 dependency warnings.
- Daily backups exist, but no restore rehearsal has been performed.
- The current secret-name inventory does not contain the planned admin-session
  and Turnstile names.
- No production setting was changed during inventory.

### 2026-07-28 - PR A local verification

- Test-first runs proved the missing edge containment and CSP compatibility
  behavior before implementation.
- Final coverage run passed all 110 test files and 1,194 tests.
- The focused edge/privacy suite passed 232 tests.
- Lint, Knip, application/Node/tooling TypeScript checks, Edge Function Deno
  checks, i18n coverage, and the i18n allowlist passed.
- `bun audit --audit-level=high` reported no vulnerabilities.
- The production build and bundle-size gate passed; the initial preloaded total
  was 206.13 KB against a 244.14 KB limit.
- Production and staging Wrangler configurations both passed `deploy --dry-run`.
- The PR Chromium smoke passed all 3 tests, including desktop/mobile axe checks
  and the stalled-service-worker recovery case, with retries disabled.
- `git diff --check`, `vercel.json` parsing, and shell syntax validation passed.
- Local actionlint could not run because Docker Desktop was not running; the
  pinned actionlint step remains mandatory in the GitHub `quality` job.
- No Cloudflare, Lovable, database, Edge Function, DNS, cache, auth, secret, or
  production deployment setting was changed.

## Current NO-GO reasons

- `snote.lovable.app` redirects to the canonical hostname; no staging-proven
  non-redirecting origin exists, so the committed Wrangler production file
  intentionally has no routes and retains a fail-closed `.invalid` placeholder.
- Production analytics is active and the analytics endpoints are not contained
  at the canonical edge.
- The canonical host is not routed through the deployed Worker.
- Production private cache/indexing behavior is proven unsafe.
- The deployed Worker does not match the repository configuration.
- Backup and recovery have not been proven.
- Required GitHub release checks and production smoke are not yet enforced.
- Managed-auth staging rehearsal is incomplete.
- The exact release candidate has not passed the 48-hour soak.
- Atomic cutover has no explicit production GO.
