# Post-deploy release attestation design

**Date:** 2026-08-30
**Status:** Approved direction; implementation not started
**Base:** `main@0d298494e0f7f9e58b836c5c07237a4e008855d8`

## Context

The strict build already emits `dist/version.json` with an exact
`deployedSha` and `capabilityRoutesEnabled` value. CI proves those fields only
for its local artifact. The post-deploy PWA workflow does not inspect the live
manifest, and its Playwright scenarios intentionally mock `/version.json`.

The live site currently serves an older manifest without either attestation
field. Public probes show that capability routing is effectively legacy-only,
but they cannot prove which source commit produced the frontend or which build
flag was used.

PR #10 has been closed as a superseded integration vehicle. Its remote branch
is intentionally retained so useful remaining work can be extracted without
merging the conflicting branch wholesale.

## Goal

Before any post-deploy PWA smoke test runs, fail closed unless the live
`/version.json` proves both:

1. the exact expected deployment commit; and
2. the explicitly expected capability-routing state.

This change prepares verification only. It does not publish a frontend or
change any cloud, database, Worker, DNS, cache, or capability state.

## Design

### Dependency-free verifier

Add `scripts/verify-live-release.ts`, using Bun/Node platform APIs only. The
module exposes a testable function and a small CLI entry point.

The CLI reads exactly three environment variables:

- `SMOKE_BASE_URL`
- `EXPECTED_DEPLOYED_SHA`
- `EXPECTED_CAPABILITY_ROUTES_ENABLED`

It validates the expected SHA as exactly 40 lowercase hexadecimal characters
and the expected capability value as exactly `true` or `false` before making a
request. It then fetches `version.json` relative to `SMOKE_BASE_URL` with
redirects rejected and cache bypass requested.

Verification succeeds only when all of these conditions hold:

- the response status is exactly `200`;
- `Cache-Control` contains the `no-store` directive;
- the body is valid JSON and is a non-array object;
- `deployedSha` is exactly the expected SHA;
- `capabilityRoutesEnabled` is a boolean exactly equal to the expected value.

Network errors, redirects, malformed JSON, absent or null fields, wrong types,
stale values, and invalid expected inputs all fail closed with concise errors.
Errors must not print the response body. A successful run may print only the
verified SHA and capability state.

### Workflow wiring

Update `.github/workflows/pwa-update-smoke-post-deploy.yml` with one
`Verify live release identity` step immediately after Bun setup and before
dependency installation, frame-ancestor checks, browser installation, or
Playwright.

For a successful `deployment_status` event:

- the expected SHA comes from `github.event.deployment.sha`;
- the expected capability state is explicitly `false` for the current
  default-off rollout.

For `workflow_dispatch`:

- `target_url` remains configurable;
- `expected_sha` is a required string input;
- `expected_capability_routes_enabled` is a required `choice` input containing
  only `false` and `true`, with `false` as the default.

An absent or malformed deployment SHA therefore fails the verifier instead of
silently weakening attestation. A future capability activation must change the
expected workflow value in a separately reviewed rollout.

The existing Playwright mocks remain unchanged. They test PWA update behavior;
the new preflight step independently tests the live release identity.

### Tests

Add one focused Node-environment Vitest file for the verifier. Use injected
`fetch` responses; never contact production from unit tests.

Table-driven cases cover:

- the exact valid manifest;
- invalid expected SHA and capability inputs before network access;
- non-200 responses and redirects;
- missing `no-store`;
- malformed or non-object JSON;
- missing, null, mistyped, or mismatched attestation fields;
- generic failure messages that do not echo a response body;
- the workflow command and its position before the existing smoke steps.

No new package, parser, retry wrapper, HTTP server, artifact format, or
general-purpose deployment abstraction is introduced.

## Operational sequence

1. Merge this source-only PR after local and required checks pass.
2. Obtain separate production approval.
3. Publish an exact-SHA strict frontend build with capability routes disabled.
4. Let the deployment-triggered workflow verify the live manifest before PWA
   smoke tests.
5. Confirm the workflow ran on the intended deployment SHA.

If attestation fails, stop. Do not rerun blindly, activate capability routes,
or bypass the preflight check. Diagnose whether the provider published the
wrong artifact, supplied the wrong deployment SHA, cached a stale manifest, or
omitted required manifest fields.

## Acceptance criteria

- The verifier is dependency-free and unit tested without network access.
- Invalid expected inputs fail before `fetch` is called.
- Live verification requires status `200`, `no-store`, exact SHA, and exact
  boolean capability state.
- The workflow runs verification before all existing post-deploy smoke work.
- Manual dispatch cannot run without an explicit expected SHA and capability
  choice.
- Existing PWA mocks and smoke behavior remain unchanged.
- The PR performs no deployment or cloud mutation.

## Non-goals

- Deploying the frontend or configuring Lovable/Cloudflare Pages.
- Activating capability routes or applying the atomic cutover migration.
- Changing Supabase, Realtime, Worker routes, DNS, caches, or secrets.
- Rewriting Home, Note, Raw, Split, extension, or PWA behavior.
- Consolidating rollback and soak-policy documentation in this PR.
- Merging or deleting `security/edge-privacy-containment`.
