---
name: snote-release
description: Use when reviewing Snote for release, deployment, rollback, or production readiness.
---

# Snote release review

Make a go/no-go decision from current evidence. Treat unknown checks as unknown,
never as passing.

## Verify

1. Run the frozen install, lint, app/node/tools typechecks, unit coverage, build
   check, workflow validation, dependency audit, and the relevant Playwright
   smoke.
2. Confirm capability isolation: anonymous callers cannot access note tables,
   note A cannot authorize note B, and owner-only management stays owner-only.
3. Confirm encrypted notes never mount plaintext UI before unlock and never
   persist plaintext in caches, local storage, snapshots, or logs.
4. Confirm share responses are `no-store`, crawler-safe, and disclose no slug
   or capability. Confirm revoked shares fail immediately.
5. Confirm offline outbox, acknowledgement, reconnection, and compaction tests
   preserve every update.
6. Confirm Privacy, extension permissions, runtime requests, canonical origin,
   and retention behavior agree.

## Release boundaries

- Never reopen direct public table access, including during rollback.
- Never log note content, slug, capability, token, or raw IP.
- Never merge or deploy while a required check is failing or unproven.
- Roll back to read-only APIs and a known-good immutable artifact.
- Run migrations on staging with synthetic data and a reviewed backup/PITR
  checkpoint before production.
- Keep legacy notes exact-match read-only; offer secure duplication instead of
  silently assigning ownership.

## Output

Return:

- `Go` only when every required item has current evidence.
- `No-go` with blockers ordered by data-loss and security risk otherwise.
- The exact commands or manual checks still needed.
- Migration order, rollback path, and monitoring signals without sensitive
  identifiers.
