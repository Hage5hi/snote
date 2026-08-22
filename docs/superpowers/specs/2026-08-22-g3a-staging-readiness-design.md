# G3A staging readiness ADR

**Status:** Approved on 2026-08-22. The operational source of truth is
[`docs/security/staging-plan-2026-08.md`](../../security/staging-plan-2026-08.md).

## Decision

1. Capability routes are enabled only when
   `VITE_CAPABILITY_ROUTES_ENABLED === "true"`. `App.tsx` owns the decision and
   passes `legacyOnly` to ordinary and split note routes. Missing or malformed
   values retain the deployed legacy-only behavior.
2. `bun run staging:prepare` creates an OS-temp Supabase workdir from a fixed
   migration allowlist. It copies Edge Functions, rewrites the project ID to
   `snote-staging-local`, rejects ambient project linkage and the production
   ref, excludes `20260724000000_atomic_capability_cutover.sql`, and records the
   source commit plus migration SHA-256 hashes. It never runs the Supabase CLI.
3. A separately approved local rehearsal starts at
   `writes=false, privateRealtime=false`, moves at most to `true,false` after
   denial/API probes, and exercises polling. Anonymous Auth, Turnstile, private
   Realtime, gateway headers, logical restore, and hosted evidence belong to a
   later separately approved staging gate.

## Non-goals

G3A does not start Docker, link or create a Supabase project, create secrets,
deploy, merge PR #10, modify production configuration, apply atomic cutover, or
introduce a feature-flag or migration framework.

## Acceptance

- route tests prove default legacy-only behavior and exact staging opt-in;
- generator tests prove the selected migration set, atomic exclusion, local
  project identity, hash manifest, outside-repository output, and fail-closed
  behavior for missing files or ambient linkage;
- existing quality, type, unit, build, audit, extension, and browser gates stay
  green on the final reviewed SHA.
