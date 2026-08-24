# Storage Delete Replay Compatibility Design

## Problem

The reviewed G3B checkout at `35e8639e` reaches the local migration chain but
fails in `20260425000000_drop_leftover_buckets.sql`. Supabase Storage
`v1.69.11` installs statement-level protection triggers on
`storage.objects` and `storage.buckets`; direct `DELETE` is rejected unless the
current transaction sets `storage.allow_delete_query=true`.

The historical cleanup migration predates that guard. Its intent is still
valid: remove two unused scaffold buckets after their policies have been
dropped. Production is not linked or contacted during this repair.

## Approaches considered

1. **Use Supabase's transaction-local deletion guard in the migration
   (selected).** Wrap the two existing deletes in one `DO` block, call
   `set_config('storage.allow_delete_query', 'true', true)` inside that block,
   and leave the target rows and ordering unchanged.
2. **Patch only the disposable G3B copy.** This would make one rehearsal pass
   but its migration bytes would no longer match the reviewed commit, so the
   evidence would not be reproducible.
3. **Pin an older Storage image.** This would hide current-runtime
   incompatibility and add obsolete infrastructure coupling.

## Design

The migration will keep all policy drops unchanged. The two `DELETE`
statements will execute inside one anonymous PostgreSQL block. Its first action
will enable `storage.allow_delete_query` with `is_local=true`, matching the
mechanism used by the installed Supabase Storage image. The setting therefore
exists only for that transaction and cannot remain enabled for later
migrations or application traffic.

No tables, policies, bucket names, timestamps, migration ordering, runtime
code, dependencies, or production configuration change. Existing production
databases have already recorded this migration version and will not replay it;
fresh and disposable databases will perform the same cleanup under the new
Storage protection contract.

## Verification

A focused source-contract test will fail on the current migration and require:

- one transaction-local `set_config` call for
  `storage.allow_delete_query=true`;
- the guard to appear before both protected-table deletes;
- no session-global `SET` or disabled protection trigger.

After the focused RED-to-GREEN cycle, run the relevant contract suite and all
normal local quality gates. Push the micro-PR only after an independent diff
review. Once CI is green, regenerate the private G3B workdir from the new SHA,
re-attest every function and migration hash, and rerun `supabase start` plus
`db reset`. The local reset is the integration proof against the exact Storage
image that exposed the incompatibility.

## Failure and rollback

If the focused test or local reset still fails, revert this micro-fix and stop;
do not weaken Storage triggers, omit the migration, or pin an older image. G3B
continues to use synthetic data only. Any failed local stack must be stopped,
its runtime secret cache removed, and its disposable workdir deleted before a
new attempt.

The Windows-only port override discovered during preflight remains an
operational G3B adjustment outside this source change; it is not generalized
into a new port-allocation subsystem.
