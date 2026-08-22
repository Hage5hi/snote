# G3A Staging Readiness Design

**Status:** Approved design; implementation has not started.

## Goal

Make the existing candidate safe to rehearse locally without enabling the
capability client in production, applying the atomic cutover migration, or
connecting the repository to any remote Supabase project.

## Scope

G3A is repository-only. It adds the smallest controls needed for a later local
rehearsal:

1. a build-time staging switch for the already-implemented capability client;
2. an isolated temporary Supabase workdir containing only the additive
   migrations approved for G3;
3. corrected rollout documentation with explicit polling-first, backup, Auth,
   function-inventory, and evidence requirements.

G3A does not start Docker, create accounts or projects, generate remote
secrets, link Supabase, deploy Edge Functions or Workers, alter production, or
merge PR #10.

## Design decisions

### 1. Capability routes remain fail-closed by default

`VITE_CAPABILITY_ROUTES_ENABLED` is enabled only when its exact value is
`"true"`. Missing, malformed, development, and production values keep both the
ordinary note route and split view in `legacyOnly` mode. `App.tsx` owns this
single decision and passes the resulting boolean to `NotePage` and
`SplitView`; no general feature-flag framework is introduced.

The local G3B build may set the flag to true. A later hosted staging build must
also identify its exact source SHA through the existing release build. No
production build may set the flag until the later production gate explicitly
authorizes it.

### 2. Local migration rehearsal uses an ephemeral allowlisted workdir

A single Bun script creates a directory under the operating-system temporary
folder. It copies the committed Supabase configuration, Edge Function sources,
and only these migrations, in this order:

- all existing base migrations through `20260427041811`;
- `20260522000000_admin_rate_limit.sql`;
- `20260719000000_security_immediate_containment.sql`;
- `20260722000000_capability_backend.sql`;
- `20260723000000_capability_checkpoint_compaction.sql`;
- `20260727000000_capability_sync_conflict_codes.sql`.

`20260724000000_atomic_capability_cutover.sql` is never copied. The script
fails if an expected file is missing, an unexpected migration is selected, the
source tree has ambient Supabase linkage, or the generated config retains the
production project reference `onfzjmfjldsbthchssfr`. The generated local
config uses a non-production local project id.

The script writes a small JSON manifest beside the generated workdir with the
source commit, selected filenames, and SHA-256 hashes. It does not execute the
Supabase CLI. G3B will run a pinned CLI against this workdir with explicit
`--workdir` and `--local` arguments. Blanket commands against the source
repository remain forbidden.

This one-purpose script replaces a generic migration orchestrator, plugin, or
new dependency.

### 3. Polling is the first runnable mode

After the additive schema is applied locally, capability runtime state begins
at `writes=false, privateRealtime=false`. G3B may transition to
`writes=true, privateRealtime=false` only after the API and protected-table
denial probes pass. Local browser probes then exercise owner/edit/view,
encryption, outbox acknowledgement, navigation, reconnect, replay, quarantine,
and checkpoint conflict behavior over polling.

Private Realtime is not claimed by G3B. It belongs to hosted G3C, where
anonymous sign-in, a staging Turnstile site key, `VITE_CAPABILITY_AUTH_ENABLED`,
JWT lifetime, private-channel authorization, and redacted logging can be proven
together. Any failed gate returns runtime state to `false,false`.

### 4. Hosted staging remains a separate approval

G3C will require a separate Supabase project and Cloudflare staging endpoint.
Before that approval, its plan must include:

- a hard allowlist for the staging project reference and rejection of the
  production reference;
- a complete desired-state list for every Edge Function, including explicit
  decisions for `raw` and `share-revoke` and each `verify_jwt` mode;
- gateway overwrite tests for both admin authentication and capability note
  creation/import;
- a manual logical dump, checksum, restore rehearsal, and post-restore probes
  because the free plan has no guaranteed PITR workflow;
- exact SPA, function, Worker, migration, runtime-state, Auth, and evidence
  identities.

No secret value is written to the repository, command output, chat, test
artifact, or evidence bundle.

## Error handling

- A false or absent route flag preserves the current legacy-only behavior.
- A preflight mismatch exits non-zero before creating a runnable workdir.
- The migration selection is explicit; adding a migration requires a reviewed
  allowlist change and a failing-then-passing contract test.
- Generated files live outside the repository and are disposable. The source
  worktree remains unchanged.
- Runtime write or Realtime enablement is a separate, reversible staging
  operation and never occurs during G3A.

## Verification

Implementation follows TDD:

1. router tests fail until both ordinary and split routes remain legacy by
   default and enable capability mode only for the exact staging flag;
2. preflight tests fail until the generated migration set excludes atomic
   cutover, rewrites the local project id, rejects ambient linkage, and records
   hashes;
3. existing capability, legacy, encryption, split-view, and build contracts
   remain green;
4. lint, Knip, TypeScript checks, Edge checks, coverage, build-size gate,
   exact-SHA release build, extension audit, PR browser gates, and full browser
   matrix run on the final immutable SHA.

## Simplicity constraints

- no new runtime dependency;
- no generic feature-flag service;
- no migration framework or remote deployment wrapper;
- no production configuration change;
- no adjacent refactor or P3 cleanup;
- every added file has one caller and one purpose, and the final diff receives
  a deletion-focused review before push.
