# Privacy Runtime Gaps Design

## Goal

Close three independent gaps that remain on `main` without importing the large,
conflicting PR #10 history:

1. Remove the development URL-sanitization panel that can expose a complete
   path, query, or fragment in browser logs.
2. Stop offering legacy share-link creation because its Edge Function is a
   permanent `410` tombstone.
3. Make the protected Storage bucket cleanup migration replayable on a clean
   database by enabling its existing delete guard only for that transaction.

## Scope

- Delete the unused debug panel, its URL-sanitization helper, and tests that
  exist only for that subsystem.
- Keep copying and revoking an already-existing legacy share token, but remove
  the dead create-token action and stale localized copy.
- Add a focused migration contract test and the smallest SQL change needed for
  clean replay.
- Write a regression test before each behavior change and run the affected
  suite before broader repository gates.

## Non-goals

- No Worker, Cloudflare route, Supabase deployment, or production mutation.
- No release/PWA harness, staging framework, completed checklist, or PR #10
  history transplant.
- No change to current capability routes, release identity, IP-header policy,
  or existing note data.

## Safety and rollout

The work lands as one reviewable micro-PR from current `main`. The migration
guard uses transaction-local configuration, so it does not weaken Storage
deletion protection outside that migration. Merge is allowed only after the
focused regressions and normal CI gates pass. Deployment remains a separate
owner-controlled step.
