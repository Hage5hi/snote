# Source-attested release identity design

## Goal

Make every intentionally releasable frontend artifact state the exact Git commit
that produced it, while leaving ordinary development builds and all application
runtime behavior unchanged.

## Chosen approach

Add one strict release-build path instead of copying the larger release/PWA
framework from PR #10.

- `bun run build` and `bun run build:check` remain ordinary builds. Their
  `version.json` gains `deployedSha: null`, making the absence of source
  attestation explicit.
- `bun run build:release` requires `SNOTE_RELEASE_SHA` to be an exact
  40-character lowercase Git SHA.
- A strict build verifies that the supplied SHA equals the clean checked-out
  `HEAD` both when Vite loads its configuration and immediately before
  `version.json` is emitted. Missing Git metadata, a dirty worktree, a changed
  `HEAD`, or a malformed/mismatched SHA fails the build.
- The strict artifact keeps the existing random `buildId` and `builtAt`, and
  adds the verified SHA as `deployedSha`.
- CI runs the strict path with `${{ github.sha }}` and reads
  `dist/version.json` back to prove the emitted SHA matches.

This provides the evidence needed for a future deployment without adding
worker-identity files, asset manifests, deterministic fixture builders, new
dependencies, or PWA-transition machinery.

## Components

- `scripts/release-identity.ts`: a small, dependency-free helper that validates
  the requested SHA and resolves a clean Git `HEAD`. Git execution is injectable
  so failure paths are tested without altering the real repository.
- `scripts/build-release.ts`: invokes the existing Vite build with strict
  attestation enabled; it performs no deployment.
- `vite.config.ts`: calls the helper at configuration and bundle-emission time,
  then adds `deployedSha` to `version.json`.
- `scripts/__tests__/release-identity.test.ts`: covers success, missing or bad
  SHA, mismatched `HEAD`, dirty worktree, unavailable Git, and bundle-time
  identity drift.
- `package.json` and `.github/workflows/ci.yml`: expose and exercise the strict
  entry point.

## Error handling and safety

Strict release builds fail closed and print only generic identity errors; they
never print repository secrets or application data. Ordinary builds do not
claim a source SHA. This change does not read or write Supabase, Cloudflare, or
Lovable and does not publish an artifact.

## Verification

Implementation follows RED-GREEN TDD for the helper and wiring contract. Before
opening the PR, run the focused tests, lint, three TypeScript checks, coverage,
`build:check`, and a strict `build:release` against the committed branch SHA.
Inspect `dist/version.json` and require exact equality with that SHA.

## Rollout boundary

The PR may be pushed for review but must not be merged or deployed as part of
this task. Capability routes, Auth, Turnstile, Realtime, `share-view`, database
flags, and migration `20260724000000` remain untouched.

The owner explicitly waived both the dormant +72-hour checkpoint and the later
fixed 48-hour production soak. Future activation therefore uses deterministic
gates only: exact-SHA artifact, fresh backup, synthetic canary, database
invariant checks, and a demonstrated rollback. No fixed waiting period remains.

## Non-goals

- No route or product behavior changes.
- No production build, publish, merge, or database mutation.
- No transplant of PR #10's PWA harness or staging framework.
- No Lovable AI usage or credits.
