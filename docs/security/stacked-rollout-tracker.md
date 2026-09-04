# Snote capability rollout tracker

Copy this document into the GitHub tracking issue. Keep every pull request in
draft until its own checks and the base PR checks are green. A checked code
item is not evidence of staging or production deployment.

## Stack

| Order | Branch | Base | Review focus |
| ---: | --- | --- | --- |
| 1 | `agent/ci-trust-baseline` | `main` | trustworthy pinned gates |
| 2 | `agent/security-immediate-containment` | `agent/ci-trust-baseline` | crawler, admin, share, encryption and PWA containment |
| 3 | `agent/security-capability-backend` | `agent/security-immediate-containment` | capability hashes, APIs, private Realtime and append-only storage |
| 4 | `agent/sync-capability-client` | `agent/security-capability-backend` | fragment capabilities, acknowledged outbox and compaction |
| 5 | `agent/security-atomic-cutover` | `agent/sync-capability-client` | public-table revocation and read-only legacy compatibility |
| 6 | `agent/fix-product-correctness` | `agent/security-atomic-cutover` | preview, split, accessibility, canonical origin, i18n and extension |
| 7 | `agent/chore-simplify-and-refresh` | `agent/fix-product-correctness` | three workflows, focused E2E, Knip and dependency cleanup |

## Code review evidence

- [ ] Every PR description links its threat model, migration order, rollback,
      and focused failing-then-passing test.
- [ ] Frozen Bun install and high-severity dependency audit pass.
- [ ] Resolve the unsuppressed
      [`brace-expansion` high-audit blocker](../security-findings.md#open-dependency-audit-blocker--no-exception-granted)
      through a compatible upstream update, separately reviewed PWA replacement,
      or separately reviewed fork.
- [ ] Lint, Knip, i18n coverage/allowlist, app/Node/tooling/Edge typechecks,
      unit coverage, build/bundle gate, and actionlint pass.
- [ ] PR Chromium smoke and extension packaging/E2E pass with zero retries.
- [ ] No committed artifact, report, bytecode, raw token, slug, note content,
      URL fragment, or raw IP appears in the diff or logs.

## Staging gate

- [ ] Record backup/PITR checkpoint and restore verification.
- [ ] Apply migrations in timestamp order with synthetic legacy, capability,
      encrypted, oversized, and revoked-share fixtures.
- [ ] Deploy Worker and containment functions, purge old cache entries, and
      verify generic crawler output across every public alias.
- [ ] Deploy capability APIs and verify note A cannot authorize any operation
      on note B.
- [ ] Verify `anon` and `authenticated` cannot access protected tables or
      append-only history directly.
- [ ] Verify navigation under 800 ms, reversed saves, reconnects, duplicate
      update IDs, encrypted recovery, and stalled PWA update without data loss.

## Production soak and cutover

SQL 240 wait on Home mint is [ADR-001](../adr/001-home-capability-mint-before-sql-240.md).

- [ ] Record a continuous 48-hour dual-mode soak with aggregate-only API
      errors, authorization denials, outbox backlog, acknowledgement latency,
      Realtime refresh failures, compaction conflicts, and quarantines.
- [ ] Confirm operational logs and retention contain no sensitive identifiers.
- [ ] Set one reviewed legacy-share cutoff at cutover plus exactly 30 days.
- [ ] Run `bun run cutover:verify` against the exact immutable release artifact.
- [ ] Apply `20260724000000_atomic_capability_cutover.sql` only after go/no-go
      approval, then run every probe in `atomic-capability-cutover.md`.
- [ ] Mark required checks only after their first real green GitHub run.

## Rollback

- [ ] Set `CAPABILITY_WRITE_DISABLED=true`.
- [ ] Keep direct table privileges and permissive policies revoked.
- [ ] Keep legacy access exact-match, read-only, and `no-store`.
- [ ] Preserve outboxes, append-only updates, checkpoints, and quarantined data.
- [ ] Roll back only to an immutable client/API/Worker set that understands
      capability and read-only legacy modes.
