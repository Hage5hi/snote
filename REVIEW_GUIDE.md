# PR #10 boundary review guide

Purpose: let a reviewer validate each security boundary of
`security/edge-privacy-containment` (base `main`) independently, without
reading 12k added lines in one pass. The delta is ~68% test/harness, ~22%
runtime+config, ~10% docs. Review the runtime boundaries first — the harness
files mostly verify them.

Delete this file after merge.

## How to run everything

```sh
bun install --frozen-lockfile
bun audit --audit-level=high
bun run lint && bun run knip
bun run i18n:check && bun run i18n:allowlist
bunx tsc --noEmit -p tsconfig.app.json
bunx tsc --noEmit -p tsconfig.node.json
bunx tsc --noEmit -p tsconfig.tools.json
bun run typecheck:edge
bun run test:coverage
bun run build:check
SNOTE_RELEASE_SHA=$(git rev-parse HEAD) bun run build:release
bash scripts/audit-extension.sh
```

The release build requires a clean Git worktree and the exact commit SHA; it
emits `deployedSha` plus the content-addressed Worker identity into
`dist/version.json`.

CI additionally runs the PR Chromium critical browser suite (`e2e-pr`) and
the extension E2E. No deploy step exists; nothing here touches production.

## Boundary 1 — Worker edge privacy containment

Runtime: `cloudflare-worker/worker.js` (631 changed lines — the core review
target). Tests: `cloudflare-worker/worker.edge-privacy.test.ts` (1,129),
`worker.share-containment.test.ts`, `scripts/__tests__/edge-privacy-contract.test.ts`.

Verify:
- crawler/private routes get generic `no-store`/`noindex` bodies that never
  contain slug, token, or note content;
- `/~api/analytics` and `/~flock.js` are denied, not proxied;
- origin/routes fail closed: both Wrangler configs are intentional no-go
  scaffolds with a `.invalid` origin. Production (`wrangler.toml`) declares
  no routes and disables workers.dev, so deploying it attaches nothing.
  Staging (`wrangler.staging.toml`) keeps workers.dev enabled for the
  reserved staging authority and would serve fail-closed responses there;
  replacing the origin with a real one, or attaching any production route,
  is a separate owner-approved step;
- logs/redirects carry no raw private identifiers (incl. query stripping on
  redirects).

Focus commits: `f9dc858c`, `a50900eb`, `c426edd5`, `8e2e88ad`, `1075b337`,
`1cba52be`, `f23f9c4d`, `726759c9`, `d3403372`, `86c5a28a`, `010e86ed`.

## Boundary 2 — release identity and clean builds

Runtime: `scripts/build-release.ts`, `scripts/release-identity.ts`.
Tests: `scripts/__tests__/release-identity-contract.test.ts` (818).

Verify: release build refuses dirty Git state, requires exact
`SNOTE_RELEASE_SHA`, and emits `deployedSha` + content-addressed Worker
identity in `version.json`. Focus commits: `3b4f2f66`, `ec15b128`,
`c43b050c`.

## Boundary 3 — PWA real-transition harness

Runtime: `src/lib/pwa-update.ts`, `vite.config.ts`.
Harness: `scripts/build-pwa-transition-fixtures.ts`, `scripts/pwa-transition-server.ts`,
`e2e/pwa-update-real-transition.spec.ts`, `playwright.pwa-transition.config.ts`.

Verify: two-build real SW transition is tested against real fixtures (not
mocks); the smoke binds to the deployed Worker identity. Focus commits:
`c9744926`, `f53bbb73`, `765e3848`.

## Boundary 4 — production read-only guards

Harness: `e2e/helpers/production-readonly.ts` (961),
`e2e/helpers/chromium-worker-attestation.ts` (941), specs
`e2e/pwa-update-production-readonly.spec.ts`,
`e2e/production-readonly-guard-local.spec.ts`, workflow
`.github/workflows/pwa-update-smoke-post-deploy.yml` (dispatch-only).

Verify: every production-touching test path is GET-only/read-only by
construction; the dispatch workflow refuses to run unless the deployed
`version.json` `deployedSha` matches the exact expected SHA. Focus commits:
`430649a7`, `dd529585`, `78500c55`, `765e3848`.

## Boundary 5 — static privacy surface

`public/_headers`, `public/robots.txt`, `vercel.json`, `index.html`,
`public/theme-init.js`, `src/pages/Privacy.tsx`. Verify headers/robots match
the Worker's containment story (no path leaks, no indexing of private
routes).

## Post-audit fixes in this branch (review separately)

- `5150177c` — dependency audit floors (3-line `bun.lock`; nanoid floor
  drifted to 3.3.18 after the handoff).
- Reserved-slug contract — `src/lib/slug.ts` + `supabase/functions/_shared/slug.ts`
  reject `note`/`privacy`/`s` at every creation/navigation site; pinned by
  `src/lib/__tests__/slug-contract.test.tsx` against the actual route table.
- ShareDialog no longer offers legacy share-link creation; `share-create`
  is a 410 tombstone and `setShareToken` is removed with it.
- README security model is labeled target architecture; current production
  is the `legacyOnly` hotfix route.
- URL-sanitize debug subsystem deleted (could log fragment capabilities to
  the console).

## Known intentional gaps (do not "fix" in review)

- Ordinary notes route `legacyOnly` until the capability cutover is
  approved — see `docs/security/release-manifests/2026-07-capability-rollout.md`.
- The atomic cutover migration must never be applied as an ordinary
  migration.
- Aggregate coverage has no CI threshold and the measured file set varies
  between local and CI runs (≈56–62% on identical heads); treat the
  percentage as non-comparable until thresholds land (audit P2, tracked
  separately).
